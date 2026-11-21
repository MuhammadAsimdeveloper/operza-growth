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
import { persistWaitingWorkflowExecution, loadAuthoritativeWorkflowExecution, persistInitialWorkflowExecution } from '../workflow-persistence.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

test('Durable Workflow Recovery, Resume Leases & Execution Ownership', async (t) => {
  const pgServer = new IsolatedTestPostgres({ port: 0, dbName: 'operza_recovery_lease_test' });
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

  await t.test('1. Setup schema and apply all migrations up through 029', async () => {
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

    const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await pool.query(sql);
    }

    // Verify migration 029 columns exist
    const colsRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'workflow_executions'
      AND column_name IN ('resume_lease_owner', 'resume_lease_until', 'resume_started_at', 'resume_token')
    `);
    assert.equal(colsRes.rows.length, 4, 'All 4 Migration 029 columns must exist on workflow_executions');

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

  await t.test('2. Manual tick expedites scheduled continuation and prevents duplicate execution', async () => {
    const execId = randomUUID();
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    const flow = {
      id: workflowId,
      name: 'Manual Tick Flow',
      version: 1,
      nodes: [
        { id: 'w1', name: 'Wait Node', type: 'wait', config: { duration: 86400 }, next: 'final_step' },
        { id: 'final_step', name: 'Final Step', type: 'set_variable', config: { name: 'done', value: 'yes' } }
      ]
    };

    // Save definition
    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT (agency_id, location_id, id) DO NOTHING
    `, [workflowId, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    // Initial trigger to reach wait node
    const outboxRepo = createWorkflowOutboxRepository(pool);
    const handlers = createTrustedWorkerHandlers({ pool, outboxRepository: outboxRepo });

    await persistInitialWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      execution: { id: execId, status: 'enqueued' },
      flow,
      triggerContext: { initiator: 'test_user' }
    });

    await produceWorkflowTriggerEvent({
      repository: outboxRepo,
      tenantId,
      locationId,
      workflowId,
      executionId: execId,
      payload: { initiator: 'test_user' }
    });

    const triggerBatch = await runOutboxBatch({
      repository: outboxRepo,
      handlers,
      workerId: 'worker_init',
      batchSize: 5
    });
    assert.equal(triggerBatch.processed, 1);

    // Verify execution is in 'waiting' state with wait_generation = 1
    const execRow = await loadAuthoritativeWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      executionId: execId
    });
    assert.equal(execRow.status, 'waiting');
    assert.equal(execRow.wait_generation, 1);
    assert.equal(execRow.current_node_id, 'w1');
    assert.equal(execRow.resume_node_id, 'final_step');

    // Verify scheduled outbox continuation is in future
    const schedJob = await pool.query(`
      SELECT id, status, available_at, (available_at > now()) AS is_future
      FROM workflow_outbox
      WHERE execution_id = $1 AND event_type = 'workflow.wait.resume'
    `, [execId]);
    assert.equal(schedJob.rows.length, 1);
    assert.equal(schedJob.rows[0].is_future, true);

    // Simulate Manual Tick: expedite the scheduled continuation
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);

      // Check existing pending event
      const pendingRes = await client.query(`
        SELECT id, status, available_at, (available_at <= now()) AS is_due
        FROM workflow_outbox
        WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3
          AND event_type = 'workflow.wait.resume'
          AND status IN ('pending', 'retryable')
          AND (payload->>'resumeGeneration')::int = 1
        FOR UPDATE
      `, [tenantId, locationId, execId]);

      assert.equal(pendingRes.rows.length, 1);
      assert.equal(pendingRes.rows[0].is_due, false);

      // Expedite event: available_at = now()
      await client.query(`
        UPDATE workflow_outbox
        SET available_at = now(),
            payload = jsonb_set(jsonb_set(payload, '{requestType}', '"manual"'), '{expeditedAt}', to_jsonb(now()::text))
        WHERE id = $1
      `, [pendingRes.rows[0].id]);

      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Repeated tick: verify idempotent detection (already due)
    const client2 = await pool.connect();
    try {
      await client2.query('BEGIN');
      await client2.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);

      const checkRes = await client2.query(`
        SELECT id, (available_at <= now()) AS is_due
        FROM workflow_outbox
        WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3
          AND event_type = 'workflow.wait.resume'
          AND status IN ('pending', 'retryable')
          AND (payload->>'resumeGeneration')::int = 1
      `, [tenantId, locationId, execId]);

      assert.equal(checkRes.rows[0].is_due, true, 'Repeated tick recognizes event is already due');
      await client2.query('COMMIT');
    } finally {
      client2.release();
    }

    // Process batch: worker resumes and completes workflow
    const resumeBatch = await runOutboxBatch({
      repository: outboxRepo,
      handlers,
      workerId: 'worker_resume',
      batchSize: 5
    });
    assert.equal(resumeBatch.processed, 1);
    assert.equal(resumeBatch.results[0].status, 'delivered');

    // Verify finished execution
    const finishedExec = await loadAuthoritativeWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      executionId: execId
    });
    assert.equal(finishedExec.status, 'completed');
    assert.equal(finishedExec.resume_lease_owner, null);
    assert.equal(finishedExec.resume_lease_until, null);
  });

  await t.test('3. Active resume lease prevents concurrent execution; expired lease recovers', async () => {
    const execId = randomUUID();

    const flow = {
      id: randomUUID(),
      name: 'Lease Recovery Flow',
      version: 1,
      nodes: [
        { id: 'w1', name: 'Wait Node', type: 'wait', config: { duration: 10 }, next: 'step_2' },
        { id: 'step_2', name: 'Step 2', type: 'set_variable', config: { name: 'recovered', value: true } }
      ]
    };

    // Save workflow definition for foreign key
    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT (agency_id, location_id, id) DO NOTHING
    `, [flow.id, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    // Initialize execution directly in waiting state with wait_generation = 1
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'step_2', 1, 'timed', now() - interval '1 second', 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [execId, tenantId, locationId, flow.id, JSON.stringify(flow)]);

    const outboxRepo = createWorkflowOutboxRepository(pool);
    const handlers = createTrustedWorkerHandlers({ pool, outboxRepository: outboxRepo });

    // Simulate Worker 1 claiming lease and setting resume_lease_owner with active lease
    const worker1Token = `worker_1_${randomUUID()}`;
    await pool.query(`
      UPDATE workflow_executions SET
        status = 'resuming',
        resume_lease_owner = $1,
        resume_lease_until = now() + interval '60 seconds',
        resume_started_at = now()
      WHERE id = $2
    `, [worker1Token, execId]);

    // Worker 2 attempts to resume: active lease conflict must be rejected!
    await assert.rejects(
      async () => {
        await handlers['workflow.wait.resume']({
          tenantId,
          locationId,
          executionId: execId,
          waitNodeId: 'w1',
          resumeNodeId: 'step_2',
          resumeGeneration: 1
        }, { workerId: 'worker_2', lease: { lost: false } });
      },
      (err) => err.code === 'RESUME_LEASE_ACTIVE_CONFLICT',
      'Worker 2 must be rejected with RESUME_LEASE_ACTIVE_CONFLICT when lease is active'
    );

    // Simulate Worker 1 crashing and lease expiring: resume_lease_until = now() - interval '5 seconds'
    await pool.query(`
      UPDATE workflow_executions SET
        resume_lease_until = now() - interval '5 seconds'
      WHERE id = $1
    `, [execId]);

    // Worker 2 attempts again: expired lease is recovered and execution completes!
    const recoverResult = await handlers['workflow.wait.resume']({
      tenantId,
      locationId,
      executionId: execId,
      waitNodeId: 'w1',
      resumeNodeId: 'step_2',
      resumeGeneration: 1
    }, { workerId: 'worker_2', lease: { lost: false } });

    assert.equal(recoverResult.status, 'completed');

    const recoveredExec = await loadAuthoritativeWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      executionId: execId
    });
    assert.equal(recoveredExec.status, 'completed');
    assert.equal(recoveredExec.resume_lease_owner, null);

    // Now test: if Worker 1 awakens late and tries to persist outcome using its stale token
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);

      const verifyRes = await client.query(`
        SELECT id, status, resume_lease_owner, (now() < resume_lease_until) AS is_lease_valid
        FROM workflow_executions
        WHERE agency_id = $1 AND location_id = $2 AND id = $3
        FOR UPDATE
      `, [tenantId, locationId, execId]);

      const cur = verifyRes.rows[0];
      const isOwner = cur.resume_lease_owner === worker1Token;
      const isLeaseValid = cur.is_lease_valid;
      assert.equal(isOwner, false, 'Worker 1 is no longer lease owner');
      assert.equal(cur.status, 'completed', 'State remains completed by Worker 2');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  await t.test('4. Stale generation and terminal executions are rejected without side effects', async () => {
    const execId = randomUUID();
    const flow = {
      id: randomUUID(),
      name: 'Stale Generation Flow',
      version: 1,
      nodes: [
        { id: 'w1', type: 'wait', config: { duration: 10 }, next: 'next_step' },
        { id: 'next_step', type: 'set_variable', config: { name: 'ok', value: true } }
      ]
    };

    // Save workflow definition for foreign key
    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT (agency_id, location_id, id) DO NOTHING
    `, [flow.id, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    // Execution currently at wait_generation = 2
    await pool.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
        wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'waiting', 'w1', 'next_step', 2, 'timed', now(), 1, $5::jsonb, '{}'::jsonb, now(), now())
    `, [execId, tenantId, locationId, flow.id, JSON.stringify(flow)]);

    const handlers = createTrustedWorkerHandlers({ pool });

    // Stale generation 1 payload
    const staleGenResult = await handlers['workflow.wait.resume']({
      tenantId,
      locationId,
      executionId: execId,
      waitNodeId: 'w1',
      resumeNodeId: 'next_step',
      resumeGeneration: 1
    }, { workerId: 'worker_stale' });

    assert.equal(staleGenResult.status, 'ignored_stale_generation');

    // Mark execution canceled
    await pool.query(`UPDATE workflow_executions SET status = 'canceled' WHERE id = $1`, [execId]);

    const canceledResult = await handlers['workflow.wait.resume']({
      tenantId,
      locationId,
      executionId: execId,
      waitNodeId: 'w1',
      resumeNodeId: 'next_step',
      resumeGeneration: 2
    }, { workerId: 'worker_term' });

    assert.equal(canceledResult.status, 'ignored_stale_state');
  });

  await t.test('5. Workflow version and snapshot are pinned on execution and unaffected by publishing v2', async () => {
    const v1WorkflowId = randomUUID();
    const exec1Id = randomUUID();
    const exec2Id = randomUUID();

    const flowV1 = {
      id: v1WorkflowId,
      name: 'Versioned Flow',
      version: 1,
      nodes: [
        { id: 'w1', type: 'wait', config: { duration: 10 }, next: 'step_post' },
        { id: 'step_post', type: 'set_variable', config: { name: 'version_tag', value: 'v1_action_applied' } }
      ]
    };

    // Save v1 definition
    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, 'Versioned Flow', 'published', 'manual', $4::jsonb, 1)
    `, [v1WorkflowId, tenantId, locationId, JSON.stringify(flowV1.nodes)]);

    const outboxRepo = createWorkflowOutboxRepository(pool);
    const handlers = createTrustedWorkerHandlers({ pool, outboxRepository: outboxRepo });

    await persistInitialWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      execution: { id: exec1Id, status: 'enqueued', workflowVersion: 1 },
      flow: flowV1,
      triggerContext: { initiator: 'test_user' }
    });

    // Trigger Execution 1 on v1
    await produceWorkflowTriggerEvent({
      repository: outboxRepo,
      tenantId,
      locationId,
      workflowId: v1WorkflowId,
      executionId: exec1Id,
      triggerContext: { initiator: 'test_user' }
    });

    await runOutboxBatch({ repository: outboxRepo, handlers, workerId: 'worker_v1_init', batchSize: 5 });

    // Verify Execution 1 pinned v1 snapshot
    const exec1Row = await loadAuthoritativeWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      executionId: exec1Id
    });
    assert.equal(exec1Row.status, 'waiting');
    assert.equal(exec1Row.workflow_version, 1);
    const snap1 = typeof exec1Row.workflow_snapshot === 'string' ? JSON.parse(exec1Row.workflow_snapshot) : exec1Row.workflow_snapshot;
    assert.equal(snap1.version, 1);
    assert.equal(snap1.nodes[1].config.value, 'v1_action_applied');

    // Update published workflow definition to Version 2 (sets version_tag to v2_action_applied)
    const flowV2Nodes = [
      { id: 'w1', type: 'wait', config: { duration: 10 }, next: 'step_post' },
      { id: 'step_post', type: 'set_variable', config: { name: 'version_tag', value: 'v2_action_applied' } }
    ];
    await pool.query(`
      UPDATE workflow_definitions
      SET version = 2, nodes = $1::jsonb, updated_at = now()
      WHERE agency_id = $2 AND location_id = $3 AND id = $4
    `, [JSON.stringify(flowV2Nodes), tenantId, locationId, v1WorkflowId]);

    // Resume Execution 1: must use pinned v1 snapshot (version_tag = 'v1_action_applied')
    const res1 = await handlers['workflow.wait.resume']({
      tenantId,
      locationId,
      executionId: exec1Id,
      waitNodeId: 'w1',
      resumeNodeId: 'step_post',
      resumeGeneration: 1,
      requestType: 'manual'
    }, { workerId: 'worker_resume_v1' });

    assert.equal(res1.status, 'completed');
    const completedExec1 = await loadAuthoritativeWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      executionId: exec1Id
    });
    assert.equal(completedExec1.state.version_tag, 'v1_action_applied', 'Execution 1 used pinned v1 snapshot');

    const flowV2 = {
      id: v1WorkflowId,
      name: 'Versioned Flow',
      version: 2,
      nodes: flowV2Nodes
    };
    await persistInitialWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      execution: { id: exec2Id, status: 'enqueued', workflowVersion: 2 },
      flow: flowV2,
      triggerContext: { initiator: 'test_user' }
    });

    // Trigger Execution 2: must pick up published Version 2 (version_tag = 'v2_action_applied')
    await produceWorkflowTriggerEvent({
      repository: outboxRepo,
      tenantId,
      locationId,
      workflowId: v1WorkflowId,
      executionId: exec2Id,
      triggerContext: { initiator: 'test_user' }
    });

    await runOutboxBatch({ repository: outboxRepo, handlers, workerId: 'worker_v2_init', batchSize: 5 });

    const exec2Row = await loadAuthoritativeWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      executionId: exec2Id
    });
    assert.equal(exec2Row.workflow_version, 2);
    const snap2 = typeof exec2Row.workflow_snapshot === 'string' ? JSON.parse(exec2Row.workflow_snapshot) : exec2Row.workflow_snapshot;
    assert.equal(snap2.version, 2);
    assert.equal(snap2.nodes[1].config.value, 'v2_action_applied');

    // Resume Execution 2: uses v2 snapshot (version_tag = 'v2_action_applied')
    const res2 = await handlers['workflow.wait.resume']({
      tenantId,
      locationId,
      executionId: exec2Id,
      waitNodeId: 'w1',
      resumeNodeId: 'step_post',
      resumeGeneration: 1,
      requestType: 'manual'
    }, { workerId: 'worker_resume_v2' });

    assert.equal(res2.status, 'completed');
    const completedExec2 = await loadAuthoritativeWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      executionId: exec2Id
    });
    assert.equal(completedExec2.state.version_tag, 'v2_action_applied', 'Execution 2 used published v2 snapshot');
  });

  await t.test('6. Webhook wait node pauses in waiting_webhook, sets token, and consumes callback securely', async () => {
    const webhookExecId = randomUUID();
    const token = `cb_${randomUUID().replace(/-/g, '')}`;

    const flow = {
      id: randomUUID(),
      name: 'Webhook Wait Flow',
      version: 1,
      nodes: [
        { id: 'start', type: 'set_variable', config: { name: 'phase', value: 'started' }, next: 'wait_hook' },
        { id: 'wait_hook', type: 'wait_webhook', config: { resumeToken: token, timeoutHours: 24 }, next: 'process_hook' },
        { id: 'process_hook', type: 'set_variable', config: { name: 'phase', value: 'hook_received' } }
      ]
    };

    // Save definition for foreign key constraint
    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'manual', $5::jsonb, 1)
      ON CONFLICT (agency_id, location_id, id) DO NOTHING
    `, [flow.id, tenantId, locationId, flow.name, JSON.stringify(flow.nodes)]);

    const outboxRepo = createWorkflowOutboxRepository(pool);
    const handlers = createTrustedWorkerHandlers({ pool, outboxRepository: outboxRepo });

    await persistInitialWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      execution: { id: webhookExecId, status: 'enqueued' },
      flow
    });

    // Trigger workflow
    await produceWorkflowTriggerEvent({
      repository: outboxRepo,
      tenantId,
      locationId,
      workflowId: flow.id,
      executionId: webhookExecId
    });

    await runOutboxBatch({ repository: outboxRepo, handlers, workerId: 'worker_hook_init', batchSize: 5 });

    // Verify paused in waiting_webhook with resume_token populated
    const pausedExec = await loadAuthoritativeWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      executionId: webhookExecId
    });
    assert.equal(pausedExec.status, 'waiting_webhook');
    assert.equal(pausedExec.wait_type, 'webhook');
    assert.equal(pausedExec.resume_token, token);
    assert.equal(pausedExec.resume_node_id, 'process_hook');

    // Test Security Definer function lookup_workflow_execution_by_resume_token
    const lookupRes = await pool.query('SELECT * FROM lookup_workflow_execution_by_resume_token($1)', [token]);
    assert.equal(lookupRes.rows.length, 1);
    assert.equal(lookupRes.rows[0].id, webhookExecId);
    assert.equal(lookupRes.rows[0].status, 'waiting_webhook');

    // Simulate callback ingestion: consume token, update state, enqueue resume event
    const callbackData = { event: 'signed', documentId: 'doc_999' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);

      // Lock row
      const lockRes = await client.query(`
        SELECT id, agency_id, location_id, workflow_id, current_node_id, resume_node_id, wait_generation
        FROM workflow_executions
        WHERE agency_id = $1 AND location_id = $2 AND id = $3 AND resume_token = $4 AND status = 'waiting_webhook'
        FOR UPDATE
      `, [tenantId, locationId, webhookExecId, token]);
      assert.equal(lockRes.rows.length, 1);

      // Invalidate token
      await client.query(`
        UPDATE workflow_executions SET
          resume_token = NULL,
          status = 'waiting',
          wait_type = 'webhook',
          state = jsonb_set(state, '{callbackData}', $1::jsonb),
          updated_at = now()
        WHERE agency_id = $2 AND location_id = $3 AND id = $4
      `, [JSON.stringify(callbackData), tenantId, locationId, webhookExecId]);

      // Enqueue resumption event
      await client.query(`
        INSERT INTO workflow_outbox (
          id, agency_id, location_id, execution_id, event_type, payload,
          idempotency_key, priority, max_attempts, available_at
        ) VALUES ($1, $2, $3, $4, 'workflow.wait.resume', $5::jsonb, $6, 0, 5, now())
      `, [
        randomUUID(), tenantId, locationId, webhookExecId,
        JSON.stringify({
          tenantId, locationId, workflowId: flow.id, executionId: webhookExecId,
          waitNodeId: 'wait_hook', resumeNodeId: 'process_hook', resumeGeneration: 0,
          requestType: 'webhook', callbackData
        }),
        `idem_hook_${token}`
      ]);

      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Verify second attempt with same token is rejected
    const secondLookup = await pool.query('SELECT * FROM lookup_workflow_execution_by_resume_token($1)', [token]);
    assert.equal(secondLookup.rows.length, 0, 'Consumed callback token can no longer be resolved');

    // Worker resumes execution with callbackData
    await runOutboxBatch({ repository: outboxRepo, handlers, workerId: 'worker_hook_resume', batchSize: 5 });

    const finishedHookExec = await loadAuthoritativeWorkflowExecution({
      pgPool: pool,
      agencyId: tenantId,
      locationId,
      executionId: webhookExecId
    });
    assert.equal(finishedHookExec.status, 'completed');
    assert.equal(finishedHookExec.state.phase, 'hook_received');
    assert.equal(finishedHookExec.state.callbackData.event, 'signed');
  });
});
