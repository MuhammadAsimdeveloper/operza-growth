import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createWorkflowOutboxRepository } from '../../../packages/db/lib/outbox-repository.mjs';
import { produceWorkflowTriggerEvent, produceWorkflowResumeEvent, produceConnectorActionEvent } from '../../../packages/platform-core/src/outbox-producer.mjs';
import { trustedWorkerHandlers, createTrustedWorkerHandlers } from '../../../packages/platform-core/src/trusted-handlers.mjs';
import { createProviderAdapterRegistry } from '../../../packages/platform-core/src/provider-adapters.mjs';
import { runOutboxBatch } from '../../../packages/platform-core/src/durable-worker.mjs';
import { IsolatedTestPostgres } from '../../../packages/db/lib/test-postgres-server.mjs';
import { executeCalendarSync } from '../../../packages/platform-core/src/calendar-sync.mjs';
import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test('Durable Workflow Execution & PostgreSQL Relational Integrity', async (t) => {
  const pgServer = new IsolatedTestPostgres({ port: 5436, dbName: 'operza_workflow_durable_test' });
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

  await t.test('1. Setup schema migrations on isolated PostgreSQL', async () => {
    const files = (await readdir(migrationsDir))
      .filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
      .sort();

    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now());');

    for (const file of files) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const sql = await readFile(path.join(migrationsDir, file), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING;', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file} failed: ${err.message}`);
      } finally {
        client.release();
      }
    }

    // Seed test agency and location
    await pool.query('INSERT INTO agencies (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [tenantId, 'Durable Agency', `agency-${tenantId.slice(0, 8)}`]);
    await pool.query('INSERT INTO locations (id, agency_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [locationId, tenantId, 'Main Location']);
  });

  const outboxRepo = createWorkflowOutboxRepository(pool);

  await t.test('2. Workflow trigger event is enqueued into PostgreSQL with pending status', async () => {
    const entry = await produceWorkflowTriggerEvent({
      repository: outboxRepo,
      tenantId,
      locationId,
      workflowId,
      triggerType: 'webhook',
      payload: {
        executionId,
        workflowName: 'Customer Inbound Onboarding'
      }
    });

    assert.ok(entry.id, 'Outbox entry ID must exist');
    assert.equal(entry.status, 'pending', 'Initial status must be pending');

    // Query directly from PostgreSQL to confirm persistent durability
    const res = await pool.query('SELECT status, event_type, agency_id FROM workflow_outbox WHERE id = $1', [entry.id]);
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].status, 'pending');
    assert.equal(res.rows[0].event_type, 'workflow.trigger.enqueued');
  });

  await t.test('3. Dedicated worker claims and executes the workflow trigger event', async () => {
    const batchResult = await runOutboxBatch({
      repository: outboxRepo,
      workerId: 'worker_node_alpha',
      handlers: trustedWorkerHandlers,
      limit: 10
    });

    assert.equal(batchResult.claimed, 1);
    assert.equal(batchResult.processed, 1);
    assert.equal(batchResult.results[0].status, 'delivered');

    // Confirm PostgreSQL row is transitioned to delivered
    const checkRes = await pool.query("SELECT status, delivered_at, result FROM workflow_outbox WHERE agency_id = $1 AND location_id = $2 AND payload->>'workflowId' = $3", [tenantId, locationId, workflowId]);
    assert.equal(checkRes.rows[0].status, 'delivered');
    assert.ok(checkRes.rows[0].delivered_at);
  });

  await t.test('4. Action Governance gates worker action execution without human approval', async () => {
    const unapprovedAction = await produceConnectorActionEvent({
      repository: outboxRepo,
      tenantId,
      locationId,
      actionId: 'email',
      input: { to: 'client@example.com', subject: 'Governed Email' },
      dryRun: false
    });

    assert.ok(unapprovedAction.id);

    // Worker attempts execution without approval: must fail permanently with APPROVAL_REQUIRED
    const batchRes = await runOutboxBatch({
      repository: outboxRepo,
      workerId: 'worker_governance_test',
      handlers: trustedWorkerHandlers,
      limit: 5
    });

    assert.equal(batchRes.claimed, 1);
    // Because APPROVAL_REQUIRED is a PermanentJobError, it lands in dead_letter
    assert.equal(batchRes.results[0].status, 'dead_letter');

    const dbRow = await pool.query('SELECT status, last_error_code FROM workflow_outbox WHERE id = $1', [unapprovedAction.id]);
    assert.equal(dbRow.rows[0].status, 'dead_letter');
    assert.equal(dbRow.rows[0].last_error_code, 'APPROVAL_REQUIRED');
  });

  await t.test('5. Approved and consented external action executes successfully with receipt', async () => {
    const actionId = `act_${randomUUID().slice(0, 8)}`;
    const approvedAction = await outboxRepo.enqueue({
      tenantId,
      locationId,
      eventType: 'workflow.action.execute',
      idempotencyKey: `idem_${randomUUID()}`,
      payload: {
        tenantId,
        locationId,
        actionId,
        nodeType: 'email',
        actionType: 'email',
        approved: true,
        approvalEvidence: { approvedBy: 'usr_approver_1' },
        consent: true,
        dryRun: false,
        input: { to: 'client@example.com', subject: 'Approved Message' }
      }
    });

    const batchRes = await runOutboxBatch({
      repository: outboxRepo,
      workerId: 'worker_governance_test_2',
      handlers: trustedWorkerHandlers,
      limit: 5
    });

    assert.equal(batchRes.claimed, 1);
    assert.equal(batchRes.results[0].status, 'delivered');

    const dbRow = await pool.query('SELECT status, result FROM workflow_outbox WHERE id = $1', [approvedAction.id]);
    assert.equal(dbRow.rows[0].status, 'delivered');
    assert.equal(dbRow.rows[0].result.status, 'completed');
    assert.ok(dbRow.rows[0].result.actionReceipt);
  });

  await t.test('6. Workflow resume event restores node state after human approval', async () => {
    const resumeEntry = await produceWorkflowResumeEvent({
      repository: outboxRepo,
      tenantId,
      locationId,
      workflowId,
      executionId,
      nodeId: 'node_send_email_step_3',
      actionHash: 'a'.repeat(64),
      approvedBy: 'usr_supervisor_99'
    });

    assert.equal(resumeEntry.status, 'pending');

    const batchRes = await runOutboxBatch({
      repository: outboxRepo,
      workerId: 'worker_resume_engine',
      handlers: trustedWorkerHandlers,
      limit: 5
    });

    assert.equal(batchRes.claimed, 1);
    assert.equal(batchRes.results[0].status, 'delivered');

    const checkRes = await pool.query('SELECT status, result FROM workflow_outbox WHERE id = $1', [resumeEntry.id]);
    assert.equal(checkRes.rows[0].status, 'delivered');
    assert.equal(checkRes.rows[0].result.status, 'resumed');
    assert.equal(checkRes.rows[0].result.nodeId, 'node_send_email_step_3');
  });

  await t.test('7. Multi-process horizontal PostgreSQL consistency', async () => {
    // Write a calendar to PostgreSQL from client 1
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
      const calId = randomUUID();
      await client.query(
        "INSERT INTO calendars (id, agency_id, location_id, name, slug, duration_min, status) " +
        "VALUES ($1, $2, $3, 'Executive Strategy Session', $4, 45, 'active')",
        [calId, tenantId, locationId, `exec-${calId.slice(0, 8)}`]
      );

      // Verify immediate read visibility from another independent connection (client 2)
      const readClient = await pool.connect();
      try {
        await readClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
        const res = await readClient.query('SELECT name, slug, duration_min, status FROM calendars WHERE id = $1', [calId]);
        assert.equal(res.rows.length, 1);
        assert.equal(res.rows[0].name, 'Executive Strategy Session');
        assert.equal(res.rows[0].duration_min, 45);
        assert.equal(res.rows[0].status, 'active');
      } finally {
        readClient.release();
      }
    } finally {
      client.release();
    }
  });

  await t.test('8. Real PostgreSQL-backed workflow graph execution', async () => {
    const realWfId = randomUUID();
    const realExecId = randomUUID();
    const dbHandlers = createTrustedWorkerHandlers({ pool });

    // Insert workflow definition in PostgreSQL
    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'webhook', $5::jsonb, 1)
    `, [
      realWfId, tenantId, locationId, 'Durable PostgreSQL Test Workflow',
      JSON.stringify([
        { id: 'start_node', type: 'trigger', next: 'step_tag' },
        { id: 'step_tag', type: 'action', config: { actionType: 'tag_contact', tag: 'Onboarded' } }
      ])
    ]);

    // Enqueue trigger event
    const triggerEntry = await produceWorkflowTriggerEvent({
      repository: outboxRepo,
      tenantId,
      locationId,
      workflowId: realWfId,
      triggerType: 'webhook',
      payload: {
        executionId: realExecId,
        workflowName: 'Durable PostgreSQL Test Workflow'
      }
    });

    assert.equal(triggerEntry.status, 'pending');

    // Worker executes the batch using PostgreSQL handlers
    const batchRes = await runOutboxBatch({
      repository: outboxRepo,
      workerId: 'worker_postgres_live_1',
      handlers: dbHandlers,
      limit: 5
    });

    assert.equal(batchRes.claimed, 1);
    assert.equal(batchRes.results[0].status, 'delivered');

    // Confirm execution record in workflow_executions table has status 'completed'
    const queryClient = await pool.connect();
    try {
      await queryClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
      const execRes = await queryClient.query(
        'SELECT status, current_node_id, finished_at FROM workflow_executions WHERE agency_id = $1 AND id = $2',
        [tenantId, realExecId]
      );
      assert.equal(execRes.rows.length, 1);
      assert.equal(execRes.rows[0].status, 'completed');
      assert.ok(execRes.rows[0].finished_at);

      // Confirm execution steps in workflow_execution_steps table
      const stepsRes = await queryClient.query(
        'SELECT node_id, status FROM workflow_execution_steps WHERE agency_id = $1 AND execution_id = $2 ORDER BY started_at ASC',
        [tenantId, realExecId]
      );
      assert.ok(stepsRes.rows.length >= 2, 'Must record each executed node in workflow_execution_steps');
      assert.equal(stepsRes.rows.some(r => r.node_id === 'start_node'), true);
      assert.equal(stepsRes.rows.some(r => r.node_id === 'step_tag'), true);
    } finally {
      queryClient.release();
    }
  });

  await t.test('9. Human approval pauses execution and real resume continues to completion', async () => {
    const pauseWfId = randomUUID();
    const pauseExecId = randomUUID();
    const dbHandlers = createTrustedWorkerHandlers({ pool });

    // Workflow with an approval step
    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, $4, 'published', 'webhook', $5::jsonb, 1)
    `, [
      pauseWfId, tenantId, locationId, 'Governed Approval Workflow',
      JSON.stringify([
        { id: 'start_approval_flow', type: 'trigger', next: 'approval_gate' },
        { id: 'approval_gate', type: 'human_approval', requiresApproval: true, next: 'post_approval_action', config: { approverRole: 'admin', description: 'Requires CEO approval' } },
        { id: 'post_approval_action', type: 'action', config: { actionType: 'tag_contact', tag: 'Approved' } }
      ])
    ]);

    // Enqueue trigger event
    await produceWorkflowTriggerEvent({
      repository: outboxRepo,
      tenantId,
      locationId,
      workflowId: pauseWfId,
      triggerType: 'webhook',
      payload: {
        executionId: pauseExecId,
        workflowName: 'Governed Approval Workflow'
      }
    });

    // Worker executes up to approval gate
    const batch1 = await runOutboxBatch({
      repository: outboxRepo,
      workerId: 'worker_approval_pause',
      handlers: dbHandlers,
      limit: 5
    });

    assert.equal(batch1.claimed, 1);
    assert.equal(batch1.results[0].status, 'delivered');

    // Confirm execution status in PostgreSQL is waiting_approval
    const scopedClient = await pool.connect();
    try {
      await scopedClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
      const execRow = await scopedClient.query(
        'SELECT status, current_node_id FROM workflow_executions WHERE agency_id = $1 AND id = $2',
        [tenantId, pauseExecId]
      );
      assert.equal(execRow.rows.length, 1);
      assert.equal(execRow.rows[0].status, 'waiting_approval');
      assert.equal(execRow.rows[0].current_node_id, 'approval_gate');

      // Confirm pending approval in workflow_approvals table
      const approvalRow = await scopedClient.query(
        'SELECT id, status, node_id FROM workflow_approvals WHERE agency_id = $1 AND execution_id = $2 AND node_id = $3',
        [tenantId, pauseExecId, 'approval_gate']
      );
      assert.equal(approvalRow.rows.length, 1);
      assert.equal(approvalRow.rows[0].status, 'pending');

      // Simulate approval granted
      await scopedClient.query(
        "UPDATE workflow_approvals SET status = 'approved', decided_at = now() WHERE agency_id = $1 AND execution_id = $2 AND node_id = $3",
        [tenantId, pauseExecId, 'approval_gate']
      );
    } finally {
      scopedClient.release();
    }

    // Enqueue resume event
    const resumeEntry = await produceWorkflowResumeEvent({
      repository: outboxRepo,
      tenantId,
      locationId,
      workflowId: pauseWfId,
      executionId: pauseExecId,
      nodeId: 'approval_gate',
      actionHash: 'b'.repeat(64),
      approvedBy: 'usr_governor_9'
    });

    assert.equal(resumeEntry.status, 'pending');

    // Worker claims and resumes from approved node
    const batch2 = await runOutboxBatch({
      repository: outboxRepo,
      workerId: 'worker_approval_resume',
      handlers: dbHandlers,
      limit: 5
    });

    assert.equal(batch2.claimed, 1);
    assert.equal(batch2.results[0].status, 'delivered');

    // Execution should now be marked 'completed' in workflow_executions
    const finalClient = await pool.connect();
    try {
      await finalClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
      const finalExec = await finalClient.query(
        'SELECT status, finished_at FROM workflow_executions WHERE agency_id = $1 AND id = $2',
        [tenantId, pauseExecId]
      );
      assert.equal(finalExec.rows.length, 1);
      assert.equal(finalExec.rows[0].status, 'completed');
      assert.ok(finalExec.rows[0].finished_at);
    } finally {
      finalClient.release();
    }
  });

  await t.test('10. Provider adapter dispatch persists real action receipt in PostgreSQL', async () => {
    let mockDispatched = false;
    const provWfId = randomUUID();
    const testAdapter = {
      providerKey: 'twilio',
      name: 'twilio_test_adapter',
      category: 'communication',
      async dispatch({ actionHash }) {
        mockDispatched = true;
        return {
          ok: true,
          providerMessageId: `msg_${randomUUID()}`,
          status: 'delivered',
          actionHash
        };
      }
    };
    const testRegistry = createProviderAdapterRegistry([testAdapter]);

    const handlersWithProvider = createTrustedWorkerHandlers({
      pool,
      providerRegistry: testRegistry
    });

    // Create workflow definition for foreign key
    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
      VALUES ($1, $2, $3, 'Provider Action Workflow', 'published', 'webhook', '[]'::jsonb, 1)
    `, [provWfId, tenantId, locationId]);

    const execId = randomUUID();
    // First create execution row with tenant scope so foreign key is satisfied
    const provClient = await pool.connect();
    try {
      await provClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
      await provClient.query(`
        INSERT INTO workflow_executions (id, agency_id, location_id, workflow_id, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'running', now(), now())
      `, [execId, tenantId, locationId, provWfId]);
    } finally {
      provClient.release();
    }

    const actionHash = 'c'.repeat(64);
    await outboxRepo.enqueue({
      tenantId,
      locationId,
      eventType: 'workflow.action.execute',
      idempotencyKey: `idem_prov_${randomUUID()}`,
      payload: {
        tenantId,
        locationId,
        executionId: execId,
        actionId: 'sms',
        nodeType: 'sms',
        actionType: 'sms',
        providerKey: 'twilio',
        approved: true,
        approvalEvidence: { approvedBy: 'admin' },
        consent: true,
        actionHash,
        input: { to: '+15551234567', message: 'Hello from durable worker' }
      }
    });

    const batchRes = await runOutboxBatch({
      repository: outboxRepo,
      workerId: 'worker_provider_dispatch',
      handlers: handlersWithProvider,
      limit: 5
    });

    assert.equal(batchRes.claimed, 1);
    assert.equal(batchRes.results[0].status, 'delivered');
    assert.equal(mockDispatched, true, 'Provider adapter dispatch must have been invoked');

    // Confirm receipt recorded in workflow_action_receipts
    const receiptClient = await pool.connect();
    try {
      await receiptClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
      const receiptRow = await receiptClient.query(
        'SELECT provider_key, status, result FROM workflow_action_receipts WHERE agency_id = $1 AND execution_id = $2',
        [tenantId, execId]
      );
      assert.equal(receiptRow.rows.length, 1);
      assert.equal(receiptRow.rows[0].provider_key, 'twilio');
      assert.equal(receiptRow.rows[0].status, 'succeeded');
    } finally {
      receiptClient.release();
    }
  });

  await t.test('11. Worker heartbeat status reflects actual alive worker vs inactive state', async () => {
    // 1. Ensure table is empty
    await pool.query('DELETE FROM worker_heartbeats');

    // Query active workers logic:
    const checkInactive = await pool.query(`
      SELECT worker_id FROM worker_heartbeats
      WHERE status = 'alive' AND last_heartbeat_at >= now() - INTERVAL '30 seconds'
    `);
    assert.equal(checkInactive.rows.length, 0, 'No active workers when table is empty');

    // 2. Insert fresh alive heartbeat
    const testWorkerId = `worker_node_${Date.now()}`;
    await pool.query(`
      INSERT INTO worker_heartbeats (worker_id, hostname, pid, last_heartbeat_at, status, metadata)
      VALUES ($1, $2, $3, now(), 'alive', '{"test":true}'::jsonb)
    `, [testWorkerId, 'worker-host-1', process.pid]);

    const checkActive = await pool.query(`
      SELECT worker_id, status FROM worker_heartbeats
      WHERE status = 'alive' AND last_heartbeat_at >= now() - INTERVAL '30 seconds'
    `);
    assert.equal(checkActive.rows.length, 1);
    assert.equal(checkActive.rows[0].worker_id, testWorkerId);

    // 3. Stale heartbeat (> 30s ago) must NOT be reported as active
    await pool.query(`
      UPDATE worker_heartbeats SET last_heartbeat_at = now() - INTERVAL '45 seconds'
      WHERE worker_id = $1
    `, [testWorkerId]);

    const checkStale = await pool.query(`
      SELECT worker_id FROM worker_heartbeats
      WHERE status = 'alive' AND last_heartbeat_at >= now() - INTERVAL '30 seconds'
    `);
    assert.equal(checkStale.rows.length, 0, 'Stale worker heartbeat (>30s) must be considered inactive');
  });

  await t.test('12. Calendar synchronization fails closed on unverified provider credentials', async () => {
    // Attempt calendar sync with unverified credentials must throw CALENDAR_AUTH_FAILED
    await assert.rejects(
      async () => {
        await executeCalendarSync({
          calendar: { id: randomUUID(), externalSync: { provider: 'google' } },
          credentials: { refreshToken: 'invalid-fake-token', clientId: 'fake', clientSecret: 'fake' },
          appointments: []
        });
      },
      (err) => {
        assert.equal(err.code, 'CALENDAR_AUTH_FAILED');
        return true;
      }
    );
  });

  await t.test('13. Multi-Process API with PostgreSQL: cross-process visibility and policy enforcement', async () => {
    const PORT_P1 = 4305;
    const PORT_P2 = 4306;
    const BASE_P1 = `http://127.0.0.1:${PORT_P1}`;
    const BASE_P2 = `http://127.0.0.1:${PORT_P2}`;
    const STORE_P1 = './scratch/store_api_multi_p1.json';
    const STORE_P2 = './scratch/store_api_multi_p2.json';
    const ADMIN_KEY = 'operza-admin-telemetry-secret-key-32chars-valid-pass';

    try { rmSync(path.join(root, 'apps/api', STORE_P1), { force: true }); } catch {}
    try { rmSync(path.join(root, 'apps/api', STORE_P2), { force: true }); } catch {}

    const commonEnv = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      MIGRATION_DATABASE_URL: dbUrl,
      OPERZA_TEST_DATABASE_URL: dbUrl,
      OPERZA_VAULT_KEY: 'test-vault-key-for-appointment-concurrency-32',
      OPERZA_ADMIN_KEY: ADMIN_KEY
    };

    const p1 = spawn('node', ['apps/api/server.mjs'], {
      cwd: root,
      stdio: 'pipe',
      env: { ...commonEnv, PORT: String(PORT_P1), DATA_FILE: STORE_P1 }
    });
    const p2 = spawn('node', ['apps/api/server.mjs'], {
      cwd: root,
      stdio: 'pipe',
      env: { ...commonEnv, PORT: String(PORT_P2), DATA_FILE: STORE_P2 }
    });

    try {
      // Wait for both processes to become healthy
      let p1Up = false, p2Up = false;
      for (let i = 0; i < 40; i++) {
        try {
          const r1 = await fetch(`${BASE_P1}/health`);
          if (r1.ok) p1Up = true;
        } catch {}
        try {
          const r2 = await fetch(`${BASE_P2}/health`);
          if (r2.ok) p2Up = true;
        } catch {}
        if (p1Up && p2Up) break;
        await sleep(250);
      }
      assert.equal(p1Up, true, 'Process 1 must become healthy');
      assert.equal(p2Up, true, 'Process 2 must become healthy');

      // 1. Sign up Agency User on Process 1
      const signupEmail = `multiproc-agency-${Date.now()}@example.com`;
      const signupRes = await fetch(`${BASE_P1}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'MultiProc Founder',
          email: signupEmail,
          password: 'Password123!',
          agencyName: 'Cross Process Agency'
        })
      });
      assert.equal(signupRes.status, 201);
      const cookies = signupRes.headers.getSetCookie ? signupRes.headers.getSetCookie() : [signupRes.headers.get('set-cookie')].filter(Boolean);
      const sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
      const csrfMatch = sessionCookie.match(/operza_csrf=([^;]+)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';

      // 2. Process 1 creates a contact in CRM
      const contactRes = await fetch(`${BASE_P1}/api/crm/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-operza-csrf': csrfToken,
          Cookie: sessionCookie
        },
        body: JSON.stringify({
          firstName: 'Postgres',
          lastName: 'Authority Lead',
          email: 'lead@postgres-authority.test',
          phone: '+15559876543'
        })
      });
      assert.equal(contactRes.status, 201);
      const createdContact = await contactRes.json();
      assert.ok(createdContact.id);

      // 3. Process 2 immediately reads contacts from PostgreSQL
      const readRes = await fetch(`${BASE_P2}/api/crm/contacts`, {
        headers: { Cookie: sessionCookie }
      });
      assert.equal(readRes.status, 200);
      const contactList = await readRes.json();
      const found = (contactList.data || contactList).find(c => c.id === createdContact.id || c.email === 'lead@postgres-authority.test');
      assert.ok(found, 'Process 2 must read authoritative contact from PostgreSQL immediately');

      // 4. Test calendar sync connect fail-closed on Process 1
      const calRes = await fetch(`${BASE_P1}/api/crm/calendars`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-operza-csrf': csrfToken,
          Cookie: sessionCookie
        },
        body: JSON.stringify({
          name: 'Calendar for Sync Test',
          slug: `cal-sync-${Date.now()}`,
          durationMin: 30,
          availability: ['09:00', '10:00'],
          status: 'active'
        })
      });
      assert.equal(calRes.status, 201);
      const calData = await calRes.json();

      const badConnectRes = await fetch(`${BASE_P1}/api/calendars/${calData.id}/sync/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-operza-csrf': csrfToken,
          Cookie: sessionCookie
        },
        body: JSON.stringify({
          provider: 'google',
          credentials: { refreshToken: 'invalid_token_xyz' }
        })
      });
      assert.equal(badConnectRes.status, 401, 'Unverified calendar credentials must return 401');
      const badConnectBody = await badConnectRes.json();
      assert.equal(badConnectBody.code, 'CALENDAR_AUTH_FAILED');

      // 5. Test unsupported integrations fail-closed
      const shopifyRes = await fetch(`${BASE_P1}/api/integrations/shopify/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-operza-csrf': csrfToken,
          Cookie: sessionCookie
        },
        body: JSON.stringify({ apiKey: 'shp_fake' })
      });
      assert.equal(shopifyRes.status, 501, 'Unsupported shopify integration must return 501');

      const stripeRes = await fetch(`${BASE_P1}/api/integrations/stripe/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-operza-csrf': csrfToken,
          Cookie: sessionCookie
        },
        body: JSON.stringify({ apiKey: 'sk_test_fake' })
      });
      assert.equal(stripeRes.status, 403, 'Stripe integration without separate auth must return 403');

      // 6. Test Agency Owner isolation from platform admin routes
      const adminUnauth = await fetch(`${BASE_P1}/api/admin/worker/status`, {
        headers: { Cookie: sessionCookie }
      });
      assert.equal(adminUnauth.status, 403, 'Agency owner must receive 403 on /api/admin/*');

      // 7. Test Admin route with platform admin key
      const adminAuth = await fetch(`${BASE_P1}/api/admin/worker/status`, {
        headers: { 'x-admin-key': ADMIN_KEY }
      });
      assert.equal(adminAuth.status, 200, 'Valid admin key must receive 200 on /api/admin/*');
      const adminBody = await adminAuth.json();
      assert.ok(['active', 'inactive'].includes(adminBody.status));
      assert.equal(adminBody.engine, 'postgresql');
    } finally {
      p1.kill('SIGTERM');
      p2.kill('SIGTERM');
      await sleep(300);
      try { rmSync(path.join(root, 'apps/api', STORE_P1), { force: true }); } catch {}
      try { rmSync(path.join(root, 'apps/api', STORE_P2), { force: true }); } catch {}
    }
  });
});
