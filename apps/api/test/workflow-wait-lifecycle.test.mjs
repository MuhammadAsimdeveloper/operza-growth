import test from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflowOutboxRepository } from '../../../packages/db/lib/outbox-repository.mjs';
import { produceWorkflowTriggerEvent, produceWorkflowWaitResumeEvent } from '../../../packages/platform-core/src/outbox-producer.mjs';
import { createTrustedWorkerHandlers } from '../../../packages/platform-core/src/trusted-handlers.mjs';
import { runOutboxBatch } from '../../../packages/platform-core/src/durable-worker.mjs';
import { IsolatedTestPostgres } from '../../../packages/db/lib/test-postgres-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

test('Durable Workflow Wait & Resume Lifecycle — PostgreSQL Integration', async (t) => {
  const pgServer = new IsolatedTestPostgres({ port: 0, dbName: 'operza_wait_resume_test' });
  const dbUrl = await pgServer.start();

  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: dbUrl, max: 10 });

  t.after(async () => {
    await pool.end();
    await pgServer.stop();
  });

  const tenantId = randomUUID();
  const locationId = randomUUID();
  const workflowId = randomUUID();
  const executionId = randomUUID();

  await t.test('1. Setup schema and apply all migrations up through 028', async () => {
    // Setup bootstrap roles
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS btree_gist;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_auth_definer') THEN
          CREATE ROLE operza_auth_definer NOLOGIN NOINHERIT BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_migrator') THEN
          CREATE ROLE operza_migrator LOGIN PASSWORD 'operza_migrator_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_app') THEN
          CREATE ROLE operza_app LOGIN PASSWORD 'operza_app_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_worker') THEN
          CREATE ROLE operza_worker LOGIN PASSWORD 'operza_worker_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
      END $$;
      GRANT USAGE, CREATE ON SCHEMA public TO operza_migrator, operza_auth_definer;
      GRANT operza_auth_definer TO operza_migrator;
    `);

    // Run all migration SQL files
    const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await pool.query(sql);
    }

    // Verify migration 028 columns exist
    const colsRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'workflow_executions'
      AND column_name IN ('wait_generation', 'workflow_version', 'workflow_snapshot', 'resume_node_id', 'wait_type')
    `);
    assert.equal(colsRes.rows.length, 5, 'All 5 Migration 028 columns must exist on workflow_executions');

    // Create test tenant fixtures
    await pool.query(`
      INSERT INTO agencies (id, name, slug)
      VALUES ($1, 'Wait Test Agency', $2)
      ON CONFLICT DO NOTHING
    `, [tenantId, `wait-agency-${tenantId}`]);

    await pool.query(`
      INSERT INTO locations (id, agency_id, name)
      VALUES ($1, $2, 'Wait Test Location')
      ON CONFLICT DO NOTHING
    `, [locationId, tenantId]);
  });

  await t.test('2. Workflow halts on wait node, persists waiting state, and enqueues continuation', async () => {
    const flow = {
      id: workflowId,
      name: 'Wait and Resume Flow',
      version: 1,
      nodes: [
        {
          id: 'step_1',
          name: 'First Step',
          type: 'set_variable',
          config: { name: 'progress', value: 'step_1_done' },
          next: 'wait_node'
        },
        {
          id: 'wait_node',
          name: 'Delay 1 Hour',
          type: 'wait',
          config: { durationMinutes: 60 },
          next: 'step_2'
        },
        {
          id: 'step_2',
          name: 'Resumed Final Step',
          type: 'set_variable',
          config: { name: 'progress', value: 'all_done' },
          next: null
        }
      ]
    };

    // Insert workflow definition
    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
    `, [workflowId, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    // Insert initial workflow execution in enqueued state
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, workflow_version, workflow_snapshot
      ) VALUES ($1, $2, $3, $4, 'enqueued', 1, $5::jsonb)
    `, [executionId, tenantId, locationId, workflowId, JSON.stringify(flow)]);

    const outboxRepo = createWorkflowOutboxRepository(pool);
    const handlers = createTrustedWorkerHandlers({ pool });

    // Execute trigger
    const triggerPayload = {
      tenantId,
      locationId,
      workflowId,
      executionId,
      flow
    };

    const triggerRes = await handlers['workflow.trigger.enqueued'](triggerPayload, {
      job: { id: 'job_init', executionId },
      workerId: 'test_worker_1',
      lease: { lost: false }
    });

    assert.equal(triggerRes.status, 'waiting');

    // Verify execution record in database
    const execRes = await pool.query(`
      SELECT status, current_node_id, resume_node_id, wait_generation, wait_type, retry_at, state
      FROM workflow_executions
      WHERE agency_id = $1 AND location_id = $2 AND id = $3
    `, [tenantId, locationId, executionId]);

    assert.equal(execRes.rows.length, 1);
    const execRow = execRes.rows[0];
    assert.equal(execRow.status, 'waiting');
    assert.equal(execRow.current_node_id, 'wait_node');
    assert.equal(execRow.resume_node_id, 'step_2');
    assert.equal(execRow.wait_generation, 1);
    assert.equal(execRow.wait_type, 'timed');
    assert.ok(execRow.retry_at);
    assert.equal(execRow.state.progress, 'step_1_done');

    // Verify outbox continuation row was inserted
    const outboxRes = await pool.query(`
      SELECT id, event_type, status, available_at, payload
      FROM workflow_outbox
      WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3
      AND event_type = 'workflow.wait.resume'
    `, [tenantId, locationId, executionId]);

    assert.equal(outboxRes.rows.length, 1);
    const outboxRow = outboxRes.rows[0];
    assert.equal(outboxRow.status, 'pending');
    assert.equal(outboxRow.payload.waitNodeId, 'wait_node');
    assert.equal(outboxRow.payload.resumeNodeId, 'step_2');
    assert.equal(outboxRow.payload.resumeGeneration, 1);
    // available_at must be in the future (around 1 hour from now)
    assert.ok(new Date(outboxRow.available_at).getTime() > Date.now() + 50 * 60 * 1000);
  });

  await t.test('3. Future continuation is not eligible for claim until available_at arrives', async () => {
    const outboxRepo = createWorkflowOutboxRepository(pool);
    // Worker tries to claim jobs right now: future job should NOT be claimed
    const claimed = await outboxRepo.claim({ workerId: 'worker_premature_claim', limit: 10 });
    const waitJob = claimed.find(j => j.executionId === executionId && j.eventType === 'workflow.wait.resume');
    assert.equal(waitJob, undefined, 'Future delayed job must not be claimed before available_at');
  });

  await t.test('4. Resuming from continuation executes from resume_node_id and finishes workflow', async () => {
    // Advance available_at and retry_at to now to simulate timer firing or manual tick
    await pool.query(`
      UPDATE workflow_outbox
      SET available_at = now() - interval '1 second'
      WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3
      AND event_type = 'workflow.wait.resume'
    `, [tenantId, locationId, executionId]);

    await pool.query(`
      UPDATE workflow_executions
      SET retry_at = now() - interval '1 second'
      WHERE agency_id = $1 AND location_id = $2 AND id = $3
    `, [tenantId, locationId, executionId]);

    const outboxRepo = createWorkflowOutboxRepository(pool);
    const handlers = createTrustedWorkerHandlers({ pool });

    // Run batch with worker — claims and executes the due continuation
    const batchResult = await runOutboxBatch({
      repository: outboxRepo,
      handlers,
      workerId: 'worker_resume_runner',
      limit: 5
    });

    assert.equal(batchResult.processed, 1);
    assert.equal(batchResult.results[0].status, 'delivered');

    // Verify execution record in database is now completed
    const execRes = await pool.query(`
      SELECT status, current_node_id, resume_node_id, wait_type, retry_at, state, finished_at
      FROM workflow_executions
      WHERE agency_id = $1 AND location_id = $2 AND id = $3
    `, [tenantId, locationId, executionId]);

    assert.equal(execRes.rows.length, 1);
    const execRow = execRes.rows[0];
    assert.equal(execRow.status, 'completed');
    assert.equal(execRow.current_node_id, null);
    assert.equal(execRow.resume_node_id, null);
    assert.equal(execRow.wait_type, null);
    assert.equal(execRow.retry_at, null);
    assert.ok(execRow.finished_at);
    assert.equal(execRow.state.progress, 'all_done');

    // Verify execution steps recorded in database
    const stepsRes = await pool.query(`
      SELECT node_id, status FROM workflow_execution_steps
      WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3
      ORDER BY started_at ASC
    `, [tenantId, locationId, executionId]);

    // Initial run: step_1, wait_node. Resume run: step_2. Total: 3 steps
    assert.equal(stepsRes.rows.length, 3);
    assert.equal(stepsRes.rows[0].node_id, 'step_1');
    assert.equal(stepsRes.rows[1].node_id, 'wait_node');
    assert.equal(stepsRes.rows[1].status, 'waiting');
    assert.equal(stepsRes.rows[2].node_id, 'step_2');
    assert.equal(stepsRes.rows[2].status, 'completed');
  });

  await t.test('5. Stale generation continuation is safely ignored without re-execution', async () => {
    const handlers = createTrustedWorkerHandlers({ pool });

    // Try to replay generation 1 on the completed execution
    const staleResult = await handlers['workflow.wait.resume']({
      tenantId,
      locationId,
      workflowId,
      executionId,
      waitNodeId: 'wait_node',
      resumeNodeId: 'step_2',
      resumeGeneration: 1
    }, {
      job: { id: 'stale_job' },
      workerId: 'worker_stale_test',
      lease: { lost: false }
    });

    assert.equal(staleResult.status, 'ignored_stale_state');
  });
});
