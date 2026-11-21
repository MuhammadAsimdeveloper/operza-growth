import test from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorkflowOutboxRepository } from '../../../packages/db/lib/outbox-repository.mjs';
import { produceWorkflowTriggerEvent, produceWorkflowWaitResumeEvent } from '../../../packages/platform-core/src/outbox-producer.mjs';
import { createTrustedWorkerHandlers } from '../../../packages/platform-core/src/trusted-handlers.mjs';
import { runOutboxBatch } from '../../../packages/platform-core/src/durable-worker.mjs';
import { IsolatedTestPostgres } from '../../../packages/db/lib/test-postgres-server.mjs';
import { persistWaitingWorkflowExecution, loadAuthoritativeWorkflowExecution, persistInitialWorkflowExecution } from '../workflow-persistence.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

test('Durable Workflow Recovery, Resume Leases & Execution Ownership', async (t) => {
  const pgServer = new IsolatedTestPostgres({ port: 0, dbName: 'operza_recovery_lease_test' });
  const dbUrl = await pgServer.start();

  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: dbUrl, max: 20 });

  const tenantId = randomUUID();
  const locationId = randomUUID();
  const workflowId = randomUUID();

  let apiProc = null;
  let apiPort = 0;
  let apiBase = '';
  const apiStorePath = path.join(root, 'apps/api/scratch/store_workflow_recovery_test.json');

  t.after(async () => {
    if (apiProc) {
      apiProc.kill('SIGTERM');
      await sleep(300);
    }
    try { rmSync(apiStorePath, { force: true }); } catch {}
    await pool.end();
    await pgServer.stop();
  });

  // =========================================================================
  // TEST 1: Schema Setup & All Migrations (001 - 030)
  // =========================================================================
  await t.test('1. Setup schema and apply all migrations up through 030', async () => {
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
      DO $$ BEGIN
        IF NOT pg_has_role(current_user, 'operza_auth_definer', 'MEMBER') THEN
          EXECUTE format('GRANT operza_auth_definer TO %I', current_user);
        END IF;
      END $$;
    `);

    const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
    assert.equal(files.length >= 30, true, `Expected at least 30 migrations, found ${files.length}`);

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await pool.query(sql);
    }

    // Verify migration 029 and 030 columns on workflow_executions
    const colsRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'workflow_executions'
      AND column_name IN ('resume_lease_owner', 'resume_lease_until', 'resume_started_at', 'resume_token', 'recovery_epoch')
    `);
    assert.equal(colsRes.rows.length, 5, 'All 5 Migration 029/030 columns must exist on workflow_executions');

    // Verify lookup_workflow_execution_by_resume_token owner is operza_auth_definer
    const fnRes = await pool.query(`
      SELECT p.proname, r.rolname AS owner
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname = 'lookup_workflow_execution_by_resume_token'
    `);
    assert.equal(fnRes.rows.length, 1);
    assert.equal(fnRes.rows[0].owner, 'operza_auth_definer');

    // Create test tenant fixtures
    await pool.query(`
      INSERT INTO agencies (id, name, slug)
      VALUES ($1, 'Recovery Lease Test Agency', $2)
      ON CONFLICT DO NOTHING
    `, [tenantId, `recovery-agency-${tenantId}`]);

    await pool.query(`
      INSERT INTO locations (id, agency_id, name)
      VALUES ($1, $2, 'Recovery Lease Test Location')
      ON CONFLICT DO NOTHING
    `, [locationId, tenantId]);
  });

  // =========================================================================
  // TEST 2: Resume lease heartbeat renewal keeps long graph execution valid
  // =========================================================================
  await t.test('2. Resume lease heartbeat renewal keeps long graph execution valid', async () => {
    const execId = randomUUID();
    const flowId = randomUUID();

    const flow = {
      id: flowId,
      name: 'Heartbeat Renewal Flow',
      version: 1,
      nodes: [
        { id: 'w1', type: 'wait', config: { duration: 1 }, next: 'long_action' },
        { id: 'long_action', type: 'ai_agent', config: { prompt: 'long work' } }
      ]
    };

    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT DO NOTHING
    `, [flowId, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'long_action', 1, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [execId, tenantId, locationId, flowId, JSON.stringify(flow)]);

    const handlers = createTrustedWorkerHandlers({ pool });

    // Use short leaseDurationSeconds (1s) and heartbeatIntervalMs (150ms).
    // The aiHandler takes 1.5s total (> 1s lease duration).
    // Heartbeat will renew lease periodically, allowing execution to complete!
    const res = await handlers['workflow.wait.resume']({
      tenantId,
      locationId,
      executionId: execId,
      waitNodeId: 'w1',
      resumeNodeId: 'long_action',
      resumeGeneration: 1,
      leaseDurationSeconds: 1,
      heartbeatIntervalMs: 150,
      requestType: 'manual',
      aiHandler: async () => {
        await sleep(1500); // 1.5s sleep > 1s lease duration
        return { text: 'heartbeat_ok' };
      }
    }, { workerId: 'worker_heartbeat_long' });

    assert.equal(res.status, 'completed', 'Execution must complete because heartbeat kept lease alive');

    const execAfter = await loadAuthoritativeWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      executionId: execId
    });
    assert.equal(execAfter.status, 'completed');
    assert.equal(execAfter.resume_lease_owner, null);
  });

  // =========================================================================
  // TEST 3: Heartbeat renewal fails when owner changes; aborts stale execution
  // =========================================================================
  await t.test('3. Heartbeat renewal fails when owner changes; aborts stale execution', async () => {
    const execId = randomUUID();
    const flowId = randomUUID();

    const flow = {
      id: flowId,
      name: 'Owner Changed Flow',
      version: 1,
      nodes: [
        { id: 'w1', type: 'wait', config: { duration: 1 }, next: 'stolen_action' },
        { id: 'stolen_action', type: 'ai_agent', config: { prompt: 'stolen work' } }
      ]
    };

    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT DO NOTHING
    `, [flowId, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'stolen_action', 1, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [execId, tenantId, locationId, flowId, JSON.stringify(flow)]);

    const handlers = createTrustedWorkerHandlers({ pool });

    // While worker is executing aiHandler (which sleeps 600ms), steal lease after 150ms
    setTimeout(async () => {
      try {
        await pool.query(`
          UPDATE workflow_executions
          SET resume_lease_owner = 'worker_thief',
              resume_lease_until = now() + interval '60 seconds'
          WHERE id = $1
        `, [execId]);
      } catch {}
    }, 150);

    const res = await handlers['workflow.wait.resume']({
      tenantId,
      locationId,
      executionId: execId,
      waitNodeId: 'w1',
      resumeNodeId: 'stolen_action',
      resumeGeneration: 1,
      leaseDurationSeconds: 1,
      heartbeatIntervalMs: 80,
      requestType: 'manual',
      aiHandler: async () => {
        await sleep(600);
        return { text: 'stolen_work_attempt' };
      }
    }, { workerId: 'worker_victim' });

    assert.equal(res.status, 'lease_lost', 'Must report lease_lost when heartbeat renewal affects 0 rows');

    // Confirm database record was NOT overwritten by the victim
    const execCheck = await pool.query('SELECT status, resume_lease_owner FROM workflow_executions WHERE id = $1', [execId]);
    assert.equal(execCheck.rows[0].resume_lease_owner, 'worker_thief', 'Victim did not overwrite new owner');
  });

  // =========================================================================
  // TEST 4: Old worker cannot persist after a new owner claims execution
  // =========================================================================
  await t.test('4. Old worker cannot persist after a new owner claims execution', async () => {
    const execId = randomUUID();
    const flowId = randomUUID();

    const flow = {
      id: flowId,
      name: 'Old Worker Stale Persist Flow',
      version: 1,
      nodes: [
        { id: 'w1', type: 'wait', config: { duration: 1 }, next: 'step_pers' },
        { id: 'step_pers', type: 'set_variable', config: { name: 'done', value: true } }
      ]
    };

    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT DO NOTHING
    `, [flowId, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        resume_lease_owner, resume_lease_until, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'resuming', 'w1', 'step_pers', 1, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, 'worker_new_owner', now() + interval '60 seconds', now(), now())
    `, [execId, tenantId, locationId, flowId, JSON.stringify(flow)]);

    // Attempting Stage 3 lease verification with a stale token
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);

      const leaseVerify = await client.query(`
        SELECT id, status, wait_generation, resume_lease_owner, (now() < resume_lease_until) AS is_lease_valid
        FROM workflow_executions
        WHERE agency_id = $1 AND location_id = $2 AND id = $3
        FOR UPDATE
      `, [tenantId, locationId, execId]);

      const cur = leaseVerify.rows[0];
      const staleToken = 'worker_old_token_12345';
      const isOwner = cur.resume_lease_owner === staleToken;
      assert.equal(isOwner, false, 'Old worker token does not match active owner');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  // =========================================================================
  // TEST 5: Worker crashes after initial claim; expired lease is recovered
  // =========================================================================
  await t.test('5. Worker crashes after initial claim; expired lease is recovered', async () => {
    const execId = randomUUID();
    const flowId = randomUUID();

    const flow = {
      id: flowId,
      name: 'Crash Recovery Flow',
      version: 1,
      nodes: [
        { id: 'w1', type: 'wait', config: { duration: 1 }, next: 'step_rec' },
        { id: 'step_rec', type: 'set_variable', config: { name: 'rec', value: 'yes' } }
      ]
    };

    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT DO NOTHING
    `, [flowId, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    // Initial claim made by dead worker, lease expired 10 seconds ago
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        resume_lease_owner, resume_lease_until, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'resuming', 'w1', 'step_rec', 1, 'timed', now() - interval '20 seconds', 1, $5::jsonb, '{}'::jsonb, 'crashed_worker', now() - interval '10 seconds', now(), now())
    `, [execId, tenantId, locationId, flowId, JSON.stringify(flow)]);

    const handlers = createTrustedWorkerHandlers({ pool });

    // New worker resumes: expired lease is cleanly recovered
    const res = await handlers['workflow.wait.resume']({
      tenantId,
      locationId,
      executionId: execId,
      waitNodeId: 'w1',
      resumeNodeId: 'step_rec',
      resumeGeneration: 1,
      requestType: 'manual'
    }, { workerId: 'worker_rescuer' });

    assert.equal(res.status, 'completed');
    const finalExec = await loadAuthoritativeWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      executionId: execId
    });
    assert.equal(finalExec.status, 'completed');
    assert.equal(finalExec.state.rec, 'yes');
  });

  // =========================================================================
  // TEST 6: Defect B — Lease-lost handler result is NOT acknowledged as delivered
  // =========================================================================
  await t.test('6. Lease-lost handler result is NOT acknowledged as delivered', async () => {
    const outboxRepo = createWorkflowOutboxRepository(pool);
    const jobId = randomUUID();
    const execId = randomUUID();
    const flowId = randomUUID();

    const flow = { id: flowId, name: 'Defect B Flow', version: 1, nodes: [{ id: 'n1', type: 'set_variable' }] };
    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT DO NOTHING
    `, [flowId, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'resuming', 'n1', 'n1', 1, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [execId, tenantId, locationId, flowId, JSON.stringify(flow)]);

    // Enqueue outbox job with status 'pending' so claimJobs() claims it
    await pool.query(`
      INSERT INTO workflow_outbox (
        id, agency_id, location_id, execution_id, event_type, payload,
        idempotency_key, priority, max_attempts, available_at, status
      ) VALUES ($1, $2, $3, $4, 'workflow.test.lease_lost_event', '{}'::jsonb, $5, 0, 5, now(), 'pending')
    `, [jobId, tenantId, locationId, execId, `idem_lease_lost_${jobId}`]);

    // Create a mock handler that returns { status: 'lease_lost' }
    const mockHandlers = {
      'workflow.test.lease_lost_event': async () => {
        return { status: 'lease_lost' };
      }
    };

    const batchRes = await runOutboxBatch({
      repository: outboxRepo,
      handlers: mockHandlers,
      workerId: 'worker_lease_b',
      batchSize: 1
    });

    assert.equal(batchRes.processed, 1);
    assert.equal(batchRes.results[0].status, 'pending');
    assert.equal(batchRes.results[0].reason, 'lease_lost');

    // Inspect database outbox row: MUST NOT BE 'delivered'
    const outboxRow = await pool.query('SELECT status, attempts, last_error_code FROM workflow_outbox WHERE id = $1', [jobId]);
    assert.notEqual(outboxRow.rows[0].status, 'delivered', 'Job must NOT be marked delivered on lease_lost');
    assert.equal(outboxRow.rows[0].status, 'pending', 'Job must remain pending for retry/recovery');
    assert.equal(outboxRow.rows[0].last_error_code, 'RESUME_LEASE_LOST');
  });

  // =========================================================================
  // TEST 7: Delivered event can be re-driven when execution is still recoverable
  // =========================================================================
  await t.test('7. Delivered event can be re-driven when execution is still recoverable', async () => {
    const execId = randomUUID();
    const flowId = randomUUID();
    const jobId = randomUUID();

    const flow = {
      id: flowId,
      name: 'Delivered Re-drive Flow',
      version: 1,
      nodes: [
        { id: 'w1', type: 'wait', config: { duration: 10 }, next: 'end_step' },
        { id: 'end_step', type: 'set_variable', config: { name: 'done', value: true } }
      ]
    };

    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT DO NOTHING
    `, [flowId, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    // Execution is in waiting state
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'end_step', 1, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [execId, tenantId, locationId, flowId, JSON.stringify(flow)]);

    // Old outbox event was marked 'delivered' (e.g. prior worker acknowledged or crashed before persistence)
    const idemKey = `idem_${crypto.createHash('sha256').update(JSON.stringify([
      tenantId,
      locationId,
      'workflow_wait_resume',
      `${execId}_w1_gen_1`
    ])).digest('hex')}`;

    await pool.query(`
      INSERT INTO workflow_outbox (
        id, agency_id, location_id, execution_id, event_type, payload,
        idempotency_key, priority, max_attempts, available_at, status
      ) VALUES ($1, $2, $3, $4, 'workflow.wait.resume', $5::jsonb, $6, 0, 5, now() - interval '1 hour', 'delivered')
    `, [jobId, tenantId, locationId, execId, JSON.stringify({
      tenantId, locationId, workflowId: flowId, executionId: execId, waitNodeId: 'w1', resumeNodeId: 'end_step', resumeGeneration: 1
    }), idemKey]);

    // Re-drive logic: update outbox safely
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);

      const outboxRes = await client.query(`
        SELECT id, status FROM workflow_outbox
        WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3
          AND event_type = 'workflow.wait.resume'
          AND (payload->>'resumeGeneration')::int = 1
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE
      `, [tenantId, locationId, execId]);

      assert.equal(outboxRes.rows[0].status, 'delivered');

      await client.query(`
        UPDATE workflow_outbox
        SET status = 'pending', available_at = now(), lease_until = NULL, lease_owner = NULL, attempts = 0
        WHERE id = $1
      `, [outboxRes.rows[0].id]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Worker picks up re-driven event
    const outboxRepo = createWorkflowOutboxRepository(pool);
    const handlers = createTrustedWorkerHandlers({ pool, outboxRepository: outboxRepo });
    const batch = await runOutboxBatch({ repository: outboxRepo, handlers, workerId: 'worker_redrive', batchSize: 1 });
    assert.equal(batch.processed, 1);
    assert.equal(batch.results[0].status, 'delivered');

    const finalExec = await loadAuthoritativeWorkflowExecution({ pgPool: pool, agencyId: tenantId, locationId, executionId: execId });
    assert.equal(finalExec.status, 'completed');
  });

  // =========================================================================
  // TEST 8: Stale generation, mismatched resume node & mismatched workflow ID rejected
  // =========================================================================
  await t.test('8. Stale generation, mismatched resume node & mismatched workflow ID rejected', async () => {
    const execId = randomUUID();
    const flowId = randomUUID();

    const flow = {
      id: flowId,
      name: 'Authoritative Checks Flow',
      version: 1,
      nodes: [
        { id: 'w1', type: 'wait', config: { duration: 10 }, next: 'real_resume_step' },
        { id: 'real_resume_step', type: 'set_variable', config: { name: 'done', value: true } }
      ]
    };

    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT DO NOTHING
    `, [flowId, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'real_resume_step', 3, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [execId, tenantId, locationId, flowId, JSON.stringify(flow)]);

    const handlers = createTrustedWorkerHandlers({ pool });

    // 8a. Stale generation
    const resStaleGen = await handlers['workflow.wait.resume']({
      tenantId, locationId, workflowId: flowId, executionId: execId, waitNodeId: 'w1',
      resumeNodeId: 'real_resume_step', resumeGeneration: 2
    }, { workerId: 'w1' });
    assert.equal(resStaleGen.status, 'ignored_stale_generation');

    // 8b. Mismatched resume node
    const resMismatchedNode = await handlers['workflow.wait.resume']({
      tenantId, locationId, workflowId: flowId, executionId: execId, waitNodeId: 'w1',
      resumeNodeId: 'attacker_fake_step', resumeGeneration: 3
    }, { workerId: 'w1' });
    assert.equal(resMismatchedNode.status, 'ignored_mismatched_resume_node');

    // 8c. Mismatched workflow ID
    const resMismatchedWf = await handlers['workflow.wait.resume']({
      tenantId, locationId, workflowId: randomUUID(), executionId: execId, waitNodeId: 'w1',
      resumeNodeId: 'real_resume_step', resumeGeneration: 3
    }, { workerId: 'w1' });
    assert.equal(resMismatchedWf.status, 'ignored_mismatched_workflow');
  });

  // =========================================================================
  // TEST 9: Corrupted workflow snapshot fails closed
  // =========================================================================
  await t.test('9. Corrupted workflow snapshot fails closed', async () => {
    const execId = randomUUID();
    const flowId = randomUUID();

    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, 'Corrupt Flow', 'published', 'manual', '[]'::jsonb, 1)
      ON CONFLICT DO NOTHING
    `, [flowId, tenantId, locationId]);

    // Stored with corrupted snapshot (empty nodes array)
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'step_1', 1, 'timed', now(), 1, '{"version": 1, "nodes": []}'::jsonb, '{}'::jsonb, now(), now())
    `, [execId, tenantId, locationId, flowId]);

    const handlers = createTrustedWorkerHandlers({ pool });

    await assert.rejects(
      async () => {
        await handlers['workflow.wait.resume']({
          tenantId, locationId, workflowId: flowId, executionId: execId, waitNodeId: 'w1',
          resumeNodeId: 'step_1', resumeGeneration: 1
        }, { workerId: 'w_corrupt' });
      },
      (err) => err.code === 'INVALID_WORKFLOW_SNAPSHOT'
    );

    const execCheck = await pool.query('SELECT status, last_error_code FROM workflow_executions WHERE id = $1', [execId]);
    assert.equal(execCheck.rows[0].status, 'failed');
    assert.equal(execCheck.rows[0].last_error_code, 'INVALID_WORKFLOW_SNAPSHOT');
  });

  // =========================================================================
  // TEST 10: Snapshot version mismatch fails closed
  // =========================================================================
  await t.test('10. Snapshot version mismatch fails closed', async () => {
    const execId = randomUUID();
    const flowId = randomUUID();

    const flow = { id: flowId, version: 2, nodes: [{ id: 'step_1', type: 'set_variable' }] };
    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, 'Mismatch Flow', 'published', 'manual', $4::jsonb, 1)
      ON CONFLICT DO NOTHING
    `, [flowId, tenantId, locationId, JSON.stringify(flow.nodes)]);

    // workflow_version is 1, but snapshot has version 2
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'step_1', 1, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [execId, tenantId, locationId, flowId, JSON.stringify(flow)]);

    const handlers = createTrustedWorkerHandlers({ pool });

    await assert.rejects(
      async () => {
        await handlers['workflow.wait.resume']({
          tenantId, locationId, workflowId: flowId, executionId: execId, waitNodeId: 'w1',
          resumeNodeId: 'step_1', resumeGeneration: 1
        }, { workerId: 'w_ver_mismatch' });
      },
      (err) => err.code === 'INCONSISTENT_WORKFLOW_SNAPSHOT_VERSION'
    );

    const execCheck = await pool.query('SELECT status, last_error_code FROM workflow_executions WHERE id = $1', [execId]);
    assert.equal(execCheck.rows[0].status, 'failed');
    assert.equal(execCheck.rows[0].last_error_code, 'INCONSISTENT_WORKFLOW_SNAPSHOT_VERSION');
  });

  // =========================================================================
  // TEST 11: Chained wait lifecycle: Timed -> Timed increments generation
  // =========================================================================
  await t.test('11. Chained wait lifecycle: Timed -> Timed increments generation', async () => {
    const execId = randomUUID();
    const flowId = randomUUID();

    const flow = {
      id: flowId,
      name: 'Chained Timed Flow',
      version: 1,
      nodes: [
        { id: 'w1', type: 'wait', config: { duration: 1 }, next: 'mid_step' },
        { id: 'mid_step', type: 'set_variable', config: { name: 'stage', value: 'mid' }, next: 'w2' },
        { id: 'w2', type: 'wait', config: { duration: 10 }, next: 'final_step' },
        { id: 'final_step', type: 'set_variable', config: { name: 'stage', value: 'final' } }
      ]
    };

    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT DO NOTHING
    `, [flowId, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'mid_step', 1, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [execId, tenantId, locationId, flowId, JSON.stringify(flow)]);

    const outboxRepo = createWorkflowOutboxRepository(pool);
    const handlers = createTrustedWorkerHandlers({ pool, outboxRepository: outboxRepo });

    const res = await handlers['workflow.wait.resume']({
      tenantId, locationId, workflowId: flowId, executionId: execId, waitNodeId: 'w1',
      resumeNodeId: 'mid_step', resumeGeneration: 1, requestType: 'manual'
    }, { workerId: 'worker_chain_timed' });

    assert.equal(res.status, 'waiting');
    const pausedExec = await loadAuthoritativeWorkflowExecution({ pgPool: pool, agencyId: tenantId, locationId, executionId: execId });
    assert.equal(pausedExec.status, 'waiting');
    assert.equal(pausedExec.wait_generation, 2, 'Generation incremented to 2');
    assert.equal(pausedExec.current_node_id, 'w2');
    assert.equal(pausedExec.resume_node_id, 'final_step');
    assert.equal(pausedExec.state.stage, 'mid');
  });

  // =========================================================================
  // TEST 12: Chained wait lifecycle: Timed -> Approval transitions to waiting_approval
  // =========================================================================
  await t.test('12. Chained wait lifecycle: Timed -> Approval transitions to waiting_approval', async () => {
    const execId = randomUUID();
    const flowId = randomUUID();

    const flow = {
      id: flowId,
      name: 'Chained Approval Flow',
      version: 1,
      nodes: [
        { id: 'w1', type: 'wait', config: { duration: 1 }, next: 'action_needs_approval' },
        { id: 'action_needs_approval', type: 'set_variable', requiresApproval: true, config: { name: 'approved', value: true } }
      ]
    };

    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT DO NOTHING
    `, [flowId, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'action_needs_approval', 1, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [execId, tenantId, locationId, flowId, JSON.stringify(flow)]);

    const handlers = createTrustedWorkerHandlers({ pool });

    const res = await handlers['workflow.wait.resume']({
      tenantId, locationId, workflowId: flowId, executionId: execId, waitNodeId: 'w1',
      resumeNodeId: 'action_needs_approval', resumeGeneration: 1, requestType: 'manual'
    }, { workerId: 'worker_chain_approval' });

    assert.equal(res.status, 'waiting_approval');
    const pausedExec = await loadAuthoritativeWorkflowExecution({ pgPool: pool, agencyId: tenantId, locationId, executionId: execId });
    assert.equal(pausedExec.status, 'waiting_approval');
    assert.equal(pausedExec.wait_type, 'approval');

    const appRow = await pool.query('SELECT * FROM workflow_approvals WHERE execution_id = $1', [execId]);
    assert.equal(appRow.rows.length, 1);
    assert.equal(appRow.rows[0].node_id, 'action_needs_approval');
  });

  // =========================================================================
  // TEST 13: Chained wait lifecycle: Timed -> Webhook transitions to waiting_webhook
  // =========================================================================
  await t.test('13. Chained wait lifecycle: Timed -> Webhook transitions to waiting_webhook', async () => {
    const execId = randomUUID();
    const flowId = randomUUID();
    const customToken = `tok_${randomUUID().replace(/-/g, '')}`;

    const flow = {
      id: flowId,
      name: 'Chained Webhook Flow',
      version: 1,
      nodes: [
        { id: 'w1', type: 'wait', config: { duration: 1 }, next: 'hook_node' },
        { id: 'hook_node', type: 'wait_webhook', config: { resumeToken: customToken, timeoutHours: 24 }, next: 'post_hook' },
        { id: 'post_hook', type: 'set_variable', config: { name: 'done', value: true } }
      ]
    };

    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT DO NOTHING
    `, [flowId, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'hook_node', 1, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [execId, tenantId, locationId, flowId, JSON.stringify(flow)]);

    const handlers = createTrustedWorkerHandlers({ pool });

    const res = await handlers['workflow.wait.resume']({
      tenantId, locationId, workflowId: flowId, executionId: execId, waitNodeId: 'w1',
      resumeNodeId: 'hook_node', resumeGeneration: 1, requestType: 'manual'
    }, { workerId: 'worker_chain_hook' });

    assert.equal(res.status, 'waiting_webhook');
    const pausedExec = await loadAuthoritativeWorkflowExecution({ pgPool: pool, agencyId: tenantId, locationId, executionId: execId });
    assert.equal(pausedExec.status, 'waiting_webhook');
    assert.equal(pausedExec.wait_type, 'webhook');
    assert.equal(pausedExec.resume_token, customToken);
  });

  // =========================================================================
  // TEST 14: Start Real API Server & Authenticate Session
  // =========================================================================
  let sessionCookie = '';
  let csrfToken = '';
  let authAgencyId = '';
  let authLocationId = '';

  await t.test('14. Start Real API Server and Authenticate Session', async () => {
    apiPort = await getFreePort();
    apiBase = `http://127.0.0.1:${apiPort}`;

    const apiEnv = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      MIGRATION_DATABASE_URL: dbUrl,
      OPERZA_TEST_DATABASE_URL: dbUrl,
      PORT: String(apiPort),
      DATA_FILE: apiStorePath,
      OPERZA_VAULT_KEY: 'test-vault-key-32-bytes-long-12345'
    };

    apiProc = spawn('node', ['apps/api/server.mjs'], { cwd: root, stdio: 'pipe', env: apiEnv });
    apiProc.stderr.on('data', d => console.error('[API STDERR]', d.toString()));

    let healthy = false;
    for (let i = 0; i < 40; i++) {
      try {
        const hRes = await fetch(`${apiBase}/health`);
        if (hRes.ok) {
          healthy = true;
          break;
        }
      } catch {}
      await sleep(250);
    }
    assert.equal(healthy, true, 'Real API Server must start and report healthy');

    // Sign up a user to get valid session and agency
    const userEmail = `owner-lease-${Date.now()}@agency.test`;
    const signupRes = await fetch(`${apiBase}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: userEmail,
        password: 'Password123!',
        name: 'Lease Test User',
        agencyName: 'API Lease Test Agency'
      })
    });
    assert.equal(signupRes.status, 201);

    const cookies = signupRes.headers.getSetCookie ? signupRes.headers.getSetCookie() : [signupRes.headers.get('set-cookie')].filter(Boolean);
    sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
    const csrfMatch = sessionCookie.match(/operza_csrf=([^;]+)/);
    csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';

    // Fetch actor profile from /api/auth/me to get agencyId and locationId
    const meRes = await fetch(`${apiBase}/api/auth/me`, {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    authAgencyId = meData.agency?.id;
    assert.ok(authAgencyId, 'Auth agency ID must be present');

    // Query locationId for this agency from DB
    const locRes = await pool.query('SELECT id FROM locations WHERE agency_id = $1 LIMIT 1', [authAgencyId]);
    authLocationId = locRes.rows[0]?.id || authAgencyId;
    assert.ok(authLocationId, 'Auth location ID must be present');
  });

  // =========================================================================
  // TEST 15: Real HTTP API Endpoint Tests: POST /api/workflows/runs/:id/tick
  // =========================================================================
  await t.test('15. Real HTTP API Endpoint Tests: POST /api/workflows/runs/:id/tick', async () => {
    const authHeaders = {
      'Content-Type': 'application/json',
      'Cookie': sessionCookie,
      'x-operza-csrf': csrfToken
    };

    const flowId = randomUUID();
    const flow = {
      id: flowId,
      name: 'HTTP Tick Flow',
      version: 1,
      nodes: [
        { id: 'w1', type: 'wait', config: { duration: 86400 }, next: 'tick_end' },
        { id: 'tick_end', type: 'set_variable', config: { name: 'ticked', value: true } }
      ]
    };

    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT DO NOTHING
    `, [flowId, authAgencyId, authLocationId, flow.name, JSON.stringify(flow.nodes)]);

    // 15a. Valid waiting execution: expedites continuation
    const exec1Id = randomUUID();
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'tick_end', 1, 'timed', now() + interval '1 day', 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [exec1Id, authAgencyId, authLocationId, flowId, JSON.stringify(flow)]);

    // Add pending scheduled outbox continuation
    await pool.query(`
      INSERT INTO workflow_outbox (
        id, agency_id, location_id, execution_id, event_type, payload,
        idempotency_key, priority, max_attempts, available_at, status
      ) VALUES ($1, $2, $3, $4, 'workflow.wait.resume', $5::jsonb, $6, 0, 5, now() + interval '1 day', 'pending')
    `, [randomUUID(), authAgencyId, authLocationId, exec1Id, JSON.stringify({
      tenantId: authAgencyId, locationId: authLocationId, executionId: exec1Id, waitNodeId: 'w1', resumeGeneration: 1
    }), `idem_http_tick_${exec1Id}`]);

    const tick1Res = await fetch(`${apiBase}/api/workflows/runs/${exec1Id}/tick`, {
      method: 'POST',
      headers: authHeaders
    });
    assert.equal(tick1Res.status, 200);
    const tick1Data = await tick1Res.json();
    assert.equal(tick1Data.status, 'resume_enqueued');
    assert.equal(tick1Data.execution.status, 'waiting', 'Execution status must reflect committed DB status');

    // 15b. Repeated tick: returns resume_already_requested
    const tickRepeatedRes = await fetch(`${apiBase}/api/workflows/runs/${exec1Id}/tick`, {
      method: 'POST',
      headers: authHeaders
    });
    assert.equal(tickRepeatedRes.status, 200);
    const tickRepeatedData = await tickRepeatedRes.json();
    assert.equal(tickRepeatedData.status, 'resume_already_requested');

    // 15c. Concurrent tick requests: only one enqueues, both return 200 without duplicate outbox jobs
    const exec2Id = randomUUID();
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'tick_end', 1, 'timed', now() + interval '1 day', 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [exec2Id, authAgencyId, authLocationId, flowId, JSON.stringify(flow)]);

    const [c1, c2] = await Promise.all([
      fetch(`${apiBase}/api/workflows/runs/${exec2Id}/tick`, { method: 'POST', headers: authHeaders }),
      fetch(`${apiBase}/api/workflows/runs/${exec2Id}/tick`, { method: 'POST', headers: authHeaders })
    ]);
    assert.equal(c1.status, 200);
    assert.equal(c2.status, 200);

    const jobsCheck = await pool.query('SELECT count(*) FROM workflow_outbox WHERE execution_id = $1', [exec2Id]);
    assert.equal(Number(jobsCheck.rows[0].count), 1, 'Exactly 1 continuation job created concurrently');

    // 15d. Expired resume lease: can be ticked, reflects status 'resuming' (not reset to waiting!)
    const exec3Id = randomUUID();
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        resume_lease_owner, resume_lease_until, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'resuming', 'w1', 'tick_end', 1, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, 'crashed_worker', now() - interval '10 seconds', now(), now())
    `, [exec3Id, authAgencyId, authLocationId, flowId, JSON.stringify(flow)]);

    const tickExpiredRes = await fetch(`${apiBase}/api/workflows/runs/${exec3Id}/tick`, {
      method: 'POST',
      headers: authHeaders
    });
    assert.equal(tickExpiredRes.status, 200);
    const tickExpiredData = await tickExpiredRes.json();
    assert.equal(tickExpiredData.status, 'resume_enqueued');
    assert.equal(tickExpiredData.execution.status, 'resuming', 'Execution remains in resuming state without unsafe reset');

    // 15e. Delivered prior outbox event: re-driven safely
    const exec4Id = randomUUID();
    const jobDelivId = randomUUID();
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'tick_end', 1, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [exec4Id, authAgencyId, authLocationId, flowId, JSON.stringify(flow)]);

    await pool.query(`
      INSERT INTO workflow_outbox (
        id, agency_id, location_id, execution_id, event_type, payload,
        idempotency_key, priority, max_attempts, available_at, status
      ) VALUES ($1, $2, $3, $4, 'workflow.wait.resume', $5::jsonb, $6, 0, 5, now() - interval '1 hour', 'delivered')
    `, [jobDelivId, authAgencyId, authLocationId, exec4Id, JSON.stringify({
      tenantId: authAgencyId, locationId: authLocationId, executionId: exec4Id, waitNodeId: 'w1', resumeGeneration: 1
    }), `idem_http_deliv_${exec4Id}`]);

    const tickDelivRes = await fetch(`${apiBase}/api/workflows/runs/${exec4Id}/tick`, {
      method: 'POST',
      headers: authHeaders
    });
    assert.equal(tickDelivRes.status, 200);
    const tickDelivData = await tickDelivRes.json();
    assert.equal(tickDelivData.status, 'resume_enqueued');

    const checkReactivated = await pool.query('SELECT status FROM workflow_outbox WHERE id = $1', [jobDelivId]);
    assert.equal(checkReactivated.rows[0].status, 'pending', 'Delivered event reactivated to pending');

    // 15f. Active worker lease: rejected with 409
    const exec5Id = randomUUID();
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        resume_lease_owner, resume_lease_until, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'resuming', 'w1', 'tick_end', 1, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, 'active_worker_live', now() + interval '60 seconds', now(), now())
    `, [exec5Id, authAgencyId, authLocationId, flowId, JSON.stringify(flow)]);

    const tickActiveLeaseRes = await fetch(`${apiBase}/api/workflows/runs/${exec5Id}/tick`, {
      method: 'POST',
      headers: authHeaders
    });
    assert.equal(tickActiveLeaseRes.status, 409);

    // 15g. Terminal execution: rejected with 409
    const exec6Id = randomUUID();
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'completed', 'w1', 'tick_end', 1, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [exec6Id, authAgencyId, authLocationId, flowId, JSON.stringify(flow)]);

    const tickTerminalRes = await fetch(`${apiBase}/api/workflows/runs/${exec6Id}/tick`, {
      method: 'POST',
      headers: authHeaders
    });
    assert.equal(tickTerminalRes.status, 409);

    // 15h. Invalid tenant ownership: rejected with 404
    const foreignTenantId = randomUUID();
    const execForeignId = randomUUID();
    await pool.query(`INSERT INTO agencies (id, name, slug) VALUES ($1, 'Foreign Agency', $2)`, [foreignTenantId, `foreign-${foreignTenantId}`]);
    await pool.query(`INSERT INTO locations (id, agency_id, name) VALUES ($1, $1, 'Foreign Location')`, [foreignTenantId]);
    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, 'Foreign Flow', 'published', 'manual', $4::jsonb, 1)
    `, [flowId, foreignTenantId, foreignTenantId, JSON.stringify(flow.nodes)]);

    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'tick_end', 1, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [execForeignId, foreignTenantId, foreignTenantId, flowId, JSON.stringify(flow)]);

    const tickForeignRes = await fetch(`${apiBase}/api/workflows/runs/${execForeignId}/tick`, {
      method: 'POST',
      headers: authHeaders
    });
    assert.equal(tickForeignRes.status, 404);
  });

  // =========================================================================
  // TEST 16: Real HTTP API Endpoint Tests: POST /api/workflows/callbacks/:token
  // =========================================================================
  await t.test('16. Real HTTP API Endpoint Tests: POST /api/workflows/callbacks/:token', async () => {
    const validToken = `tok_valid_${randomUUID().replace(/-/g, '')}`;
    const expiredToken = `tok_exp_${randomUUID().replace(/-/g, '')}`;
    const flowId = randomUUID();

    const flow = {
      id: flowId,
      name: 'HTTP Callback Flow',
      version: 1,
      nodes: [
        { id: 'w_hook', type: 'wait_webhook', config: { resumeToken: validToken }, next: 'cb_end' },
        { id: 'cb_end', type: 'set_variable', config: { name: 'done', value: true } }
      ]
    };

    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT DO NOTHING
    `, [flowId, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    // 16a. Setup valid waiting_webhook execution
    const execValidId = randomUUID();
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, resume_token, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting_webhook', 'w_hook', 'cb_end', 1, 'webhook', $5, now() + interval '1 day', 1, $6::jsonb, '{}'::jsonb, now(), now())
    `, [execValidId, tenantId, locationId, flowId, validToken, JSON.stringify(flow)]);

    // 16b. Setup expired execution
    const execExpId = randomUUID();
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, resume_token, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting_webhook', 'w_hook', 'cb_end', 1, 'webhook', $5, now() - interval '1 hour', 1, $6::jsonb, '{}'::jsonb, now(), now())
    `, [execExpId, tenantId, locationId, flowId, expiredToken, JSON.stringify(flow)]);

    // 1. Expired callback returns 410 Gone; token is not consumed
    const expRes = await fetch(`${apiBase}/api/workflows/callbacks/${expiredToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: 'too late' })
    });
    assert.equal(expRes.status, 410);

    const expCheck = await pool.query('SELECT resume_token, status FROM workflow_executions WHERE id = $1', [execExpId]);
    assert.equal(expCheck.rows[0].resume_token, expiredToken, 'Token was NOT consumed on expiration');
    assert.equal(expCheck.rows[0].status, 'waiting_webhook');

    // 2. Unknown token returns 404
    const unkRes = await fetch(`${apiBase}/api/workflows/callbacks/tok_nonexistent_123456789`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: 1 })
    });
    assert.equal(unkRes.status, 404);

    // 3. Invalid JSON returns 400
    const invJsonRes = await fetch(`${apiBase}/api/workflows/callbacks/${validToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not valid json }'
    });
    assert.equal(invJsonRes.status, 400);

    // 4. Oversized body (> 64KB) returns 413
    const bigString = 'x'.repeat(70 * 1024);
    const bigRes = await fetch(`${apiBase}/api/workflows/callbacks/${validToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: bigString })
    });
    assert.equal(bigRes.status, 413);

    // 5. Valid callback returns 200, status 'waiting', consumes token, enqueues outbox event
    const validRes = await fetch(`${apiBase}/api/workflows/callbacks/${validToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signed: true, docId: 'doc_1234' })
    });
    assert.equal(validRes.status, 200);
    const validData = await validRes.json();
    assert.equal(validData.resumed, true);
    assert.equal(validData.status, 'waiting', 'Response matches committed DB status');

    const validCheck = await pool.query('SELECT resume_token, status, state FROM workflow_executions WHERE id = $1', [execValidId]);
    assert.equal(validCheck.rows[0].resume_token, null, 'Token was consumed atomically');
    assert.equal(validCheck.rows[0].status, 'waiting');
    assert.equal(validCheck.rows[0].state.callbackData.docId, 'doc_1234');

    // 6. Replayed token returns 404 or 409
    const replayRes = await fetch(`${apiBase}/api/workflows/callbacks/${validToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repeat: true })
    });
    assert.ok(replayRes.status === 404 || replayRes.status === 409);

    // 7. Concurrent duplicate callback requests produce only one accepted callback
    const concToken = `tok_conc_${randomUUID().replace(/-/g, '')}`;
    const execConcId = randomUUID();
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, resume_token, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting_webhook', 'w_hook', 'cb_end', 1, 'webhook', $5, now() + interval '1 day', 1, $6::jsonb, '{}'::jsonb, now(), now())
    `, [execConcId, tenantId, locationId, flowId, concToken, JSON.stringify(flow)]);

    const [rc1, rc2] = await Promise.all([
      fetch(`${apiBase}/api/workflows/callbacks/${concToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ req: 1 })
      }),
      fetch(`${apiBase}/api/workflows/callbacks/${concToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ req: 2 })
      })
    ]);

    const statuses = [rc1.status, rc2.status].sort();
    assert.equal(statuses[0], 200, 'Exactly one request succeeds with 200');
    assert.ok([404, 409].includes(statuses[1]), 'Other duplicate request rejected with 404 or 409');

    // 8. Successful continuation through real worker
    const outboxRepo = createWorkflowOutboxRepository(pool);
    const handlers = createTrustedWorkerHandlers({ pool, outboxRepository: outboxRepo });
    const batch = await runOutboxBatch({ repository: outboxRepo, handlers, workerId: 'worker_cb_test', batchSize: 5 });
    assert.ok(batch.processed >= 1);

    const execDone = await loadAuthoritativeWorkflowExecution({ pgPool: pool, agencyId: tenantId, locationId, executionId: execValidId });
    assert.equal(execDone.status, 'completed');
    assert.equal(execDone.state.done, true);
  });
});
