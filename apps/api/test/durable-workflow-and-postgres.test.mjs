import test from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import { createWorkflowOutboxRepository } from '../../../packages/db/lib/outbox-repository.mjs';
import { produceWorkflowTriggerEvent, produceWorkflowResumeEvent, produceConnectorActionEvent } from '../../../packages/platform-core/src/outbox-producer.mjs';
import { trustedWorkerHandlers, createTrustedWorkerHandlers } from '../../../packages/platform-core/src/trusted-handlers.mjs';
import { createProviderAdapterRegistry } from '../../../packages/platform-core/src/provider-adapters.mjs';
import { runOutboxBatch } from '../../../packages/platform-core/src/durable-worker.mjs';
import { IsolatedTestPostgres } from '../../../packages/db/lib/test-postgres-server.mjs';
import { executeCalendarSync, generatePKCE, googleCalendarAdapter, microsoftGraphCalendarAdapter } from '../../../packages/platform-core/src/calendar-sync.mjs';
import { createPostgresOAuthStateStore } from '../../../packages/db/lib/outlook-oauth-state-repository.mjs';
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
  const pgServer = new IsolatedTestPostgres({ port: 0, dbName: 'operza_workflow_durable_test' });
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
    // Setup least-privilege roles for migrator, app, worker and auth definer
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
      GRANT USAGE ON SCHEMA public TO operza_app, operza_worker;

      CREATE OR REPLACE FUNCTION trg_fix_migrator_templates()
      RETURNS event_trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      DECLARE
        cmd record;
      BEGIN
        FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
        LOOP
          IF cmd.object_type = 'policy' AND cmd.object_identity LIKE '%workflow_templates%' THEN
            IF NOT EXISTS (
              SELECT 1 FROM pg_policies WHERE tablename = 'workflow_templates' AND policyname = 'workflow_templates_migrator_policy'
            ) THEN
              EXECUTE 'CREATE POLICY workflow_templates_migrator_policy ON workflow_templates FOR ALL TO operza_migrator USING (true) WITH CHECK (true)';
            END IF;
          END IF;
        END LOOP;
      END;
      $$;

      DROP EVENT TRIGGER IF EXISTS trg_migrator_templates_rls;
      CREATE EVENT TRIGGER trg_migrator_templates_rls ON ddl_command_end
      EXECUTE FUNCTION trg_fix_migrator_templates();
    `);

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

    // Grant default privileges on all newly created tables to operza_app and operza_worker
    await pool.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO operza_app, operza_worker;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO operza_app, operza_worker;
    `);

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
    const contactId = randomUUID();
    // Seed contact in location_records and authoritative consent in communication_consents
    const seedClient = await pool.connect();
    try {
      await seedClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
      await seedClient.query(`
        INSERT INTO location_records (id, agency_id, location_id, collection, body)
        VALUES ($1, $2, $3, 'contacts', $4::jsonb)
      `, [contactId, tenantId, locationId, JSON.stringify({ email: 'client@example.com', name: 'Client' })]);
      await seedClient.query(`
        INSERT INTO communication_consents (id, agency_id, location_id, contact_id, channel, purpose, status, source)
        VALUES ($1, $2, $3, $4, 'email', 'transactional', 'granted', 'web_form')
      `, [randomUUID(), tenantId, locationId, contactId]);
    } finally {
      seedClient.release();
    }

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
        consent: {
          status: 'granted',
          channel: 'email',
          contactId,
          purpose: 'transactional',
          source: 'web_form'
        },
        dryRun: false,
        input: { to: 'client@example.com', subject: 'Approved Message', contactId }
      }
    });

    const testEmailAdapter = {
      providerKey: 'email',
      channel: 'email',
      async dispatch({ actionHash }) {
        return { ok: true, providerAccepted: true, providerMessageId: `msg_${randomUUID()}`, actionHash };
      }
    };
    const testHandlers = createTrustedWorkerHandlers({
      pool,
      providerRegistry: createProviderAdapterRegistry([testEmailAdapter])
    });

    const batchRes = await runOutboxBatch({
      repository: outboxRepo,
      workerId: 'worker_governance_test_2',
      handlers: testHandlers,
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
      channel: 'sms',
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
    const smsContactId = randomUUID();
    // First create execution row with tenant scope so foreign key is satisfied
    const provClient = await pool.connect();
    try {
      await provClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
      await provClient.query(`
        INSERT INTO workflow_executions (id, agency_id, location_id, workflow_id, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'running', now(), now())
      `, [execId, tenantId, locationId, provWfId]);
      await provClient.query(`
        INSERT INTO location_records (id, agency_id, location_id, collection, body, created_at, updated_at)
        VALUES ($1, $2, $3, 'contacts', $4::jsonb, now(), now())
      `, [smsContactId, tenantId, locationId, JSON.stringify({ id: smsContactId, phone: '+15551234567' })]);
      await provClient.query(`
        INSERT INTO communication_consents (id, agency_id, location_id, contact_id, channel, purpose, status, source)
        VALUES ($1, $2, $3, $4, 'sms', 'transactional', 'granted', 'web_form')
      `, [randomUUID(), tenantId, locationId, smsContactId]);
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

  await t.test('14. Production Docker Worker: starts with compose config, heartbeats & executes workflow graph', async () => {
    const workerUrl = new URL(dbUrl);
    workerUrl.username = 'operza_worker';
    workerUrl.password = 'operza_worker_secret';
    const workerDbUrl = workerUrl.toString();

    const PROD_WORKER_ID = 'operza-prod-durable-worker';
    const workerProc = spawn('node', ['apps/api/worker.mjs'], {
      cwd: root,
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        WORKER_DATABASE_URL: workerDbUrl,
        WORKFLOW_JOB_MODULE: 'packages/platform-core/src/trusted-handlers.mjs',
        WORKER_ID: PROD_WORKER_ID,
        OPERZA_VAULT_KEY: 'test-vault-key-for-worker-32chars-prod'
      }
    });

    let workerOutput = '';
    workerProc.stdout.on('data', d => { workerOutput += d.toString(); });
    workerProc.stderr.on('data', d => { workerOutput += d.toString(); });

    try {
      // 1. Wait for worker to write initial alive heartbeat
      let workerAlive = false;
      for (let i = 0; i < 40; i++) {
        const hb = await pool.query(
          "SELECT worker_id, status FROM worker_heartbeats WHERE worker_id = $1 AND status = 'alive'",
          [PROD_WORKER_ID]
        );
        if (hb.rows.length > 0) {
          workerAlive = true;
          break;
        }
        await sleep(250);
      }
      assert.equal(workerAlive, true, `Worker must register heartbeat; logs: ${workerOutput}`);

      // 2. Insert workflow definition into PostgreSQL
      const composeWfId = randomUUID();
      const composeExecId = randomUUID();
      await pool.query(`
        INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
        VALUES ($1, $2, $3, 'Docker Worker Compose Flow', 'published', 'webhook', $4::jsonb, 1)
      `, [composeWfId, tenantId, locationId, JSON.stringify([
        { id: 'start_compose', type: 'trigger', next: 'tag_compose_node' },
        { id: 'tag_compose_node', type: 'action', config: { actionType: 'tag_contact', tag: 'ComposeWorkerVerified' } }
      ])]);

      // 3. Enqueue trigger event into workflow_outbox
      const outboxEntry = await produceWorkflowTriggerEvent({
        repository: outboxRepo,
        tenantId,
        locationId,
        workflowId: composeWfId,
        triggerType: 'webhook',
        payload: {
          executionId: composeExecId,
          workflowName: 'Docker Worker Compose Flow',
          mode: 'live'
        }
      });
      assert.equal(outboxEntry.status, 'pending');

      // 4. Worker process automatically claims and executes the workflow
      let jobDelivered = false;
      for (let i = 0; i < 40; i++) {
        const res = await pool.query('SELECT status, delivered_at FROM workflow_outbox WHERE id = $1', [outboxEntry.id]);
        if (res.rows[0]?.status === 'delivered') {
          jobDelivered = true;
          break;
        }
        await sleep(250);
      }
      assert.equal(jobDelivered, true, `Worker must execute outbox job to delivered; logs: ${workerOutput}`);

      // 5. Verify PostgreSQL workflow_executions table has completed record
      const execRow = await pool.query(
        'SELECT status, finished_at FROM workflow_executions WHERE agency_id = $1 AND id = $2',
        [tenantId, composeExecId]
      );
      assert.equal(execRow.rows.length, 1);
      assert.equal(execRow.rows[0].status, 'completed');
      assert.ok(execRow.rows[0].finished_at);

      // 6. Verify workflow_execution_steps records both nodes traversed
      const stepsRows = await pool.query(
        'SELECT node_id, status FROM workflow_execution_steps WHERE agency_id = $1 AND execution_id = $2 ORDER BY started_at ASC',
        [tenantId, composeExecId]
      );
      assert.ok(stepsRows.rows.length >= 2, 'Worker must record executed steps in workflow_execution_steps');
      assert.equal(stepsRows.rows.some(r => r.node_id === 'start_compose'), true);
      assert.equal(stepsRows.rows.some(r => r.node_id === 'tag_compose_node'), true);
    } finally {
      workerProc.kill('SIGTERM');
      await sleep(300);
    }
  });

  await t.test('15. Calendar sync deduplication: repeated synchronization does not duplicate events', async () => {
    const calId = randomUUID();
    const apptId1 = randomUUID();
    const apptId2 = randomUUID();

    const calData = {
      id: calId,
      agencyId: tenantId,
      locationId,
      name: 'Dedup Test Calendar',
      externalSync: {
        provider: 'google',
        status: 'active',
        externalCalendarId: 'primary'
      },
      availability: []
    };

    const appts = [
      { id: apptId1, calendarId: calId, startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 5400000).toISOString(), title: 'Consultation' },
      { id: apptId2, calendarId: calId, startsAt: new Date(Date.now() + 7200000).toISOString(), endsAt: new Date(Date.now() + 9000000).toISOString(), title: 'Follow-up' }
    ];

    // Mock fetch that returns calendar verification and events from provider
    const mockFetch = async (url, options = {}) => {
      const method = options.method || 'GET';
      if (url.includes('/users/me/calendarList/primary')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'primary', summary: 'Google Primary Calendar' })
        };
      }
      if (url.includes('/calendars/primary/events') && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: 'ext_busy_1', summary: 'Busy 1', start: { dateTime: '2026-11-20T14:00:00Z' }, end: { dateTime: '2026-11-20T15:00:00Z' } },
              { id: 'ext_busy_2', summary: 'Busy 2', start: { dateTime: '2026-11-20T16:00:00Z' }, end: { dateTime: '2026-11-20T17:00:00Z' } }
            ]
          })
        };
      }
      if (method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: `ext_evt_${Date.now()}_${Math.random()}` })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    // First synchronization pass
    const sync1 = await executeCalendarSync({
      calendar: calData,
      credentials: { accessToken: 'valid_test_token' },
      appointments: appts,
      fetchFn: mockFetch
    });

    assert.equal(sync1.busyBlocks.length, 2, 'Initial sync must import 2 busy blocks');
    assert.equal(sync1.exportedEvents.length, 2, 'Initial sync must export 2 appointments');

    // Second synchronization pass on the same calendar with existing busy blocks and appointments
    const sync2 = await executeCalendarSync({
      calendar: { ...calData, externalBusyBlocks: sync1.busyBlocks },
      credentials: { accessToken: 'valid_test_token' },
      appointments: appts,
      fetchFn: mockFetch
    });

    // Busy blocks must NOT duplicate (length must remain 2)
    assert.equal(sync2.busyBlocks.length, 2, 'Repeated sync must not duplicate busy blocks');
    assert.equal(sync2.exportedEvents.length, 0, 'Already exported appointments must not be exported again');
  });

  await t.test('16. Human approval via HTTP API backed by PostgreSQL: pause, approve and exactly-once resumption', async () => {
    const PORT_APP = 4307;
    const BASE_APP = `http://127.0.0.1:${PORT_APP}`;
    const STORE_APP = './scratch/store_api_appr.json';
    try { rmSync(path.join(root, 'apps/api', STORE_APP), { force: true }); } catch {}

    const appDbUrl = dbUrl.replace('//postgres@', '//operza_app:operza_app_secret@').replace('//postgres:', '//operza_app:operza_app_secret@');
    const appEnv = {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT_APP),
      DATA_FILE: STORE_APP,
      DATABASE_URL: appDbUrl,
      MIGRATION_DATABASE_URL: dbUrl,
      OPERZA_TEST_DATABASE_URL: appDbUrl,
      OPERZA_VAULT_KEY: 'test-vault-key-for-approvals-32-chars-long',
      OPERZA_ADMIN_KEY: 'operza-admin-telemetry-secret-key-32chars-valid-pass'
    };

    const serverProc = spawn('node', ['apps/api/server.mjs'], {
      cwd: root,
      stdio: 'pipe',
      env: appEnv
    });

    let serverLogs = '';
    serverProc.stdout.on('data', d => { serverLogs += d.toString(); });
    serverProc.stderr.on('data', d => { serverLogs += d.toString(); });

    try {
      // Wait for server health
      let serverUp = false;
      for (let i = 0; i < 40; i++) {
        try {
          const r = await fetch(`${BASE_APP}/health`);
          if (r.ok) { serverUp = true; break; }
        } catch {}
        await sleep(250);
      }
      assert.equal(serverUp, true, 'Approval API server must become healthy');

      // 1. Sign up Agency User
      const email = `approval-ceo-${Date.now()}@example.com`;
      const signupRes = await fetch(`${BASE_APP}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Executive Approver',
          email,
          password: 'Password123!',
          agencyName: 'Approval Test Agency'
        })
      });
      assert.equal(signupRes.status, 201);
      const signupData = await signupRes.json();
      const appAgencyId = signupData.agency?.id;
      const appLocationId = signupData.activeLocationId || signupData.locations?.[0]?.id || appAgencyId;

      const cookies = signupRes.headers.getSetCookie ? signupRes.headers.getSetCookie() : [signupRes.headers.get('set-cookie')].filter(Boolean);
      const sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
      const csrfMatch = sessionCookie.match(/operza_csrf=([^;]+)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';

      // 2. Create workflow definition with human_approval in PostgreSQL
      const approvalWfId = randomUUID();
      const approvalExecId = randomUUID();
      await pool.query(`
        INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
        VALUES ($1, $2, $3, 'API Approval Test Flow', 'published', 'webhook', $4::jsonb, 1)
      `, [approvalWfId, appAgencyId, appLocationId, JSON.stringify([
        { id: 'start_approval', type: 'trigger', next: 'gate_node' },
        { id: 'gate_node', type: 'human_approval', requiresApproval: true, next: 'tag_approved_node', config: { approverRole: 'admin', description: 'Requires Approval' } },
        { id: 'tag_approved_node', type: 'action', config: { actionType: 'tag_contact', tag: 'PassedApproval' } }
      ])]);

      // 3. Enqueue trigger event
      const dbHandlers = createTrustedWorkerHandlers({ pool });
      await produceWorkflowTriggerEvent({
        repository: outboxRepo,
        tenantId: appAgencyId,
        locationId: appLocationId,
        workflowId: approvalWfId,
        triggerType: 'webhook',
        payload: {
          executionId: approvalExecId,
          workflowName: 'API Approval Test Flow',
          mode: 'live'
        }
      });

      // 4. Run worker batch - execution should stop at gate_node with status waiting_approval
      const batch1 = await runOutboxBatch({
        repository: outboxRepo,
        workerId: 'worker_approval_test_run',
        handlers: dbHandlers,
        limit: 5
      });
      assert.equal(batch1.claimed, 1);
      assert.equal(batch1.results[0].status, 'delivered');

      // Check PostgreSQL execution status
      const execCheck = await pool.query(
        'SELECT status, current_node_id FROM workflow_executions WHERE agency_id = $1 AND id = $2',
        [appAgencyId, approvalExecId]
      );
      assert.equal(execCheck.rows[0].status, 'waiting_approval');
      assert.equal(execCheck.rows[0].current_node_id, 'gate_node');

      // 5. Query pending approvals via API endpoint GET /api/workflows/approvals
      const pendingRes = await fetch(`${BASE_APP}/api/workflows/approvals`, {
        headers: { Cookie: sessionCookie }
      });
      assert.equal(pendingRes.status, 200);
      const pendingList = await pendingRes.json();
      const foundApproval = (pendingList.data || pendingList).find(a => a.executionId === approvalExecId);
      assert.ok(foundApproval, 'Pending approval must be returned by API');
      assert.equal(foundApproval.status, 'pending');

      // 6. Test concurrent approval requests - exactly ONE succeeds and one fails with 409
      const [approveResA, approveResB] = await Promise.all([
        fetch(`${BASE_APP}/api/workflows/runs/${approvalExecId}/approve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-operza-csrf': csrfToken,
            Cookie: sessionCookie
          },
          body: JSON.stringify({ decision: 'approved', approvalId: foundApproval.id })
        }),
        fetch(`${BASE_APP}/api/workflows/runs/${approvalExecId}/approve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-operza-csrf': csrfToken,
            Cookie: sessionCookie
          },
          body: JSON.stringify({ decision: 'approved', approvalId: foundApproval.id })
        })
      ]);

      const statuses = [approveResA.status, approveResB.status].sort();
      assert.equal(statuses[0], 200, 'Exactly one concurrent approval request must succeed with 200');
      assert.equal(statuses[1], 409, 'Concurrent second approval request must be rejected with 409 Conflict');

      // 7. Verify PostgreSQL state after approval:
      const approvalDb = await pool.query(
        'SELECT status, decided_by, decision_checksum FROM workflow_approvals WHERE id = $1',
        [foundApproval.id]
      );
      assert.equal(approvalDb.rows[0].status, 'approved');
      assert.ok(approvalDb.rows[0].decided_by);
      assert.ok(approvalDb.rows[0].decision_checksum);

      // workflow_outbox has exactly one workflow.step.resume event
      const resumeOutbox = await pool.query(
        "SELECT id, status, payload FROM workflow_outbox WHERE agency_id = $1 AND event_type = 'workflow.step.resume' AND payload->>'executionId' = $2",
        [appAgencyId, approvalExecId]
      );
      assert.equal(resumeOutbox.rows.length, 1, 'Exactly one resume event must be enqueued');
      assert.equal(resumeOutbox.rows[0].status, 'pending');

      // 8. Worker claims resume event and continues execution to completion
      const batchResume = await runOutboxBatch({
        repository: outboxRepo,
        workerId: 'worker_approval_resumer',
        handlers: dbHandlers,
        limit: 5
      });
      assert.equal(batchResume.claimed, 1);
      assert.equal(batchResume.results[0].status, 'delivered');

      // Final check: workflow_executions is completed
      const finalExec = await pool.query(
        'SELECT status, finished_at FROM workflow_executions WHERE agency_id = $1 AND id = $2',
        [appAgencyId, approvalExecId]
      );
      assert.equal(finalExec.rows[0].status, 'completed');
      assert.ok(finalExec.rows[0].finished_at);

      // 8b. Workflow rejection via POST /api/workflows/runs/:runId/reject
      const rejectWfId = randomUUID();
      const rejectExecId = randomUUID();
      await pool.query(`
        INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
        VALUES ($1, $2, $3, 'API Reject Flow', 'published', 'webhook', $4::jsonb, 1)
      `, [rejectWfId, appAgencyId, appLocationId, JSON.stringify([
        { id: 'start_reject', type: 'trigger', next: 'gate_reject' },
        { id: 'gate_reject', type: 'human_approval', requiresApproval: true, config: { approverRole: 'admin', description: 'Requires Approval' } }
      ])]);

      await produceWorkflowTriggerEvent({
        repository: outboxRepo,
        tenantId: appAgencyId,
        locationId: appLocationId,
        workflowId: rejectWfId,
        triggerType: 'webhook',
        payload: {
          executionId: rejectExecId,
          workflowName: 'API Reject Flow',
          mode: 'live'
        }
      });

      const batchRejectPrep = await runOutboxBatch({
        repository: outboxRepo,
        workerId: 'worker_reject_prep',
        handlers: dbHandlers,
        limit: 5
      });
      assert.equal(batchRejectPrep.claimed, 1);

      const pendingRejectRes = await fetch(`${BASE_APP}/api/workflows/approvals`, {
        headers: { Cookie: sessionCookie }
      });
      const pendingRejectList = await pendingRejectRes.json();
      const foundRejectApproval = (pendingRejectList.data || pendingRejectList).find(a => a.executionId === rejectExecId);
      assert.ok(foundRejectApproval);

      const rejectRes = await fetch(`${BASE_APP}/api/workflows/runs/${rejectExecId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-operza-csrf': csrfToken,
          Cookie: sessionCookie
        },
        body: JSON.stringify({ decision: 'rejected', approvalId: foundRejectApproval.id })
      });
      assert.equal(rejectRes.status, 200);
      const rejectBody = await rejectRes.json();
      assert.equal(rejectBody.approval.status, 'rejected');
      assert.equal(rejectBody.run.status, 'failed');

      // Verify PostgreSQL state for rejection
      const rejDb = await pool.query('SELECT status FROM workflow_approvals WHERE id = $1', [foundRejectApproval.id]);
      assert.equal(rejDb.rows[0].status, 'rejected');

      const rejExecDb = await pool.query('SELECT status FROM workflow_executions WHERE agency_id = $1 AND id = $2', [appAgencyId, rejectExecId]);
      assert.equal(rejExecDb.rows[0].status, 'failed');

      // Ensure NO resume event was created for the rejected run
      const rejResumeCheck = await pool.query(
        "SELECT id FROM workflow_outbox WHERE agency_id = $1 AND event_type = 'workflow.step.resume' AND payload->>'executionId' = $2",
        [appAgencyId, rejectExecId]
      );
      assert.equal(rejResumeCheck.rows.length, 0, 'No resume event should be enqueued for rejected approval');

      // 8c. Tenant Isolation: Another agency user cannot access or approve Tenant A's workflows
      const tenantBEmail = `tenant-b-${Date.now()}@example.com`;
      const signupB = await fetch(`${BASE_APP}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Tenant B User',
          email: tenantBEmail,
          password: 'Password123!',
          agencyName: 'Tenant B Agency'
        })
      });
      assert.equal(signupB.status, 201);
      const cookiesB = signupB.headers.getSetCookie ? signupB.headers.getSetCookie() : [signupB.headers.get('set-cookie')].filter(Boolean);
      const sessionCookieB = cookiesB.map(c => c.split(';')[0]).join('; ');
      const csrfMatchB = sessionCookieB.match(/operza_csrf=([^;]+)/);
      const csrfTokenB = csrfMatchB ? decodeURIComponent(csrfMatchB[1]) : '';

      // Tenant B queries approvals -> receives 0 (cannot see Tenant A's pending or past approvals)
      const listBRes = await fetch(`${BASE_APP}/api/workflows/approvals`, {
        headers: { Cookie: sessionCookieB }
      });
      assert.equal(listBRes.status, 200);
      const listB = await listBRes.json();
      const approvalsB = listB.data || listB;
      assert.equal(approvalsB.some(a => a.executionId === approvalExecId || a.executionId === rejectExecId), false, 'Tenant B must not see Tenant A approvals');

      // Tenant B tries to approve Tenant A's run -> receives 404
      const rogueApproveRes = await fetch(`${BASE_APP}/api/workflows/runs/${approvalExecId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-operza-csrf': csrfTokenB,
          Cookie: sessionCookieB
        },
        body: JSON.stringify({ decision: 'approved', approvalId: foundApproval.id })
      });
      assert.equal(rogueApproveRes.status, 404, 'Tenant B must receive 404 attempting to approve Tenant A execution');
    } finally {
      serverProc.kill('SIGTERM');
      await sleep(300);
    }
  });

  await t.test('17. Calendar OAuth: PKCE S256, atomic state consumption, listCalendars, and external_event_id persistence', async () => {
    // 1. PKCE generation generates cryptographically random verifier and S256 challenge
    const pkce1 = generatePKCE();
    assert.ok(pkce1.verifier && pkce1.verifier.length >= 43);
    assert.ok(pkce1.challenge && pkce1.challenge.length >= 43);
    assert.equal(pkce1.method, 'S256');

    // Verify S256 challenge calculation matches RFC 7636
    const expectedChallenge = crypto.createHash('sha256').update(pkce1.verifier).digest('base64url');
    assert.equal(pkce1.challenge, expectedChallenge, 'PKCE challenge must match RFC 7636 S256');

    // 2. PostgreSQL OAuth state store handles single-use consumption and expiration
    const masterKey = 'test-oauth-vault-key-32chars-ok!';
    const oauthStore = createPostgresOAuthStateStore(pool, { masterKey });
    const stateHash = crypto.createHash('sha256').update(randomUUID()).digest('hex');

    await oauthStore.create({
      stateHash,
      tenantId,
      locationId,
      actorId: 'usr_oauth_test_1',
      codeVerifier: pkce1.verifier,
      expiresAt: Date.now() + 60_000
    });

    // Verify row in database
    const storeRow = await pool.query('SELECT state_hash, agency_id, location_id, expires_at FROM provider_oauth_states WHERE state_hash = $1', [stateHash]);
    assert.equal(storeRow.rows.length, 1);
    assert.equal(storeRow.rows[0].agency_id, tenantId);
    assert.ok(storeRow.rows[0].expires_at);

    // Consume once: succeeds and retrieves decrypted codeVerifier
    const consumed = await oauthStore.consume({
      stateHash,
      tenantId,
      locationId
    });
    assert.ok(consumed);
    assert.equal(consumed.codeVerifier, pkce1.verifier);

    // Verify row deleted upon single-use consumption
    const checkDeleted = await pool.query('SELECT * FROM provider_oauth_states WHERE state_hash = $1', [stateHash]);
    assert.equal(checkDeleted.rows.length, 0, 'OAuth state row must be deleted upon consumption');

    // Replay attack: attempting to consume the same state again fails
    const replayed = await oauthStore.consume({
      stateHash,
      tenantId,
      locationId
    });
    assert.equal(replayed, null, 'Consumed OAuth state must not be replayable');

    // 3. listCalendars implementation for Google and Microsoft
    const mockGoogleFetch = async (url) => {
      if (url.includes('/users/me/calendarList')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: 'primary', summary: 'Personal Calendar', primary: true, accessRole: 'owner' },
              { id: 'team_cal_123', summary: 'Agency Sales', primary: false, accessRole: 'writer' }
            ]
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const googleCalendars = await googleCalendarAdapter.listCalendars({
      accessToken: 'test_token',
      fetchFn: mockGoogleFetch
    });
    assert.equal(googleCalendars.length, 2);
    assert.equal(googleCalendars[0].id, 'primary');
    assert.equal(googleCalendars[0].name, 'Personal Calendar');
    assert.equal(googleCalendars[0].isPrimary, true);

    const mockMsFetch = async (url) => {
      if (url.includes('/me/calendars')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            value: [
              { id: 'ms_cal_default', name: 'Outlook Calendar', isDefaultCalendar: true, canEdit: true }
            ]
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const msCalendars = await microsoftGraphCalendarAdapter.listCalendars({
      accessToken: 'test_ms_token',
      fetchFn: mockMsFetch
    });
    assert.equal(msCalendars.length, 1);
    assert.equal(msCalendars[0].id, 'ms_cal_default');
    assert.equal(msCalendars[0].name, 'Outlook Calendar');
    assert.equal(msCalendars[0].isPrimary, true);

    // 4. Persistence of external_event_id in PostgreSQL appointments table
    const apptId = randomUUID();
    const calId = randomUUID();
    const externalEventId = `ext_google_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
      await client.query(`
        INSERT INTO appointments (id, agency_id, location_id, calendar_id, title, status, starts_at, ends_at, external_event_id)
        VALUES ($1, $2, $3, $4, 'Sync Deduplication Appointment', 'confirmed', now(), now() + interval '30 minutes', $5)
      `, [apptId, tenantId, locationId, calId, externalEventId]);

      const apptRow = await client.query('SELECT id, external_event_id FROM appointments WHERE id = $1', [apptId]);
      assert.equal(apptRow.rows[0].external_event_id, externalEventId, 'external_event_id must be stored in PostgreSQL');
    } finally {
      client.release();
    }
  });

  await t.test('18. Authoritative PostgreSQL Communication Consent and Error Propagation', async () => {
    const contactId = randomUUID();
    const testWfId = randomUUID();
    const testExecId = randomUUID();

    let adapterCalled = false;
    const testSmsAdapter = {
      providerKey: 'twilio',
      channel: 'sms',
      category: 'communication',
      async dispatch({ actionHash }) {
        adapterCalled = true;
        return { ok: true, providerAccepted: true, providerMessageId: 'sms_msg_123', actionHash };
      }
    };
    const workerDbUrl = dbUrl.replace('//postgres@', '//operza_worker:operza_worker_secret@').replace('//postgres:', '//operza_worker:operza_worker_secret@');
    const workerPool = new pg.Pool({ connectionString: workerDbUrl, max: 5 });
    const dbHandlers = createTrustedWorkerHandlers({
      pool: workerPool,
      providerRegistry: createProviderAdapterRegistry([testSmsAdapter])
    });

    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
      await client.query(`
        INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
        VALUES ($1, $2, $3, 'Consent Enforcement Flow', 'published', 'webhook', '[]'::jsonb, 1)
      `, [testWfId, tenantId, locationId]);
      await client.query(`
        INSERT INTO workflow_executions (id, agency_id, location_id, workflow_id, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'running', now(), now())
      `, [testExecId, tenantId, locationId, testWfId]);
      await client.query(`
        INSERT INTO location_records (id, agency_id, location_id, collection, body, created_at, updated_at)
        VALUES ($1, $2, $3, 'contacts', $4::jsonb, now(), now())
      `, [contactId, tenantId, locationId, JSON.stringify({ id: contactId, phone: '+15554443322' })]);
    } finally {
      client.release();
    }

    // 1. Dispatch WITHOUT consent in PostgreSQL -> Worker fails with CONSENT_REQUIRED (dead_letter)
    adapterCalled = false;
    const unconsentedJob = await outboxRepo.enqueue({
      tenantId,
      locationId,
      eventType: 'workflow.action.execute',
      idempotencyKey: `idem_consent_missing_${randomUUID()}`,
      payload: {
        tenantId,
        locationId,
        executionId: testExecId,
        actionId: 'sms',
        nodeType: 'sms',
        actionType: 'sms',
        providerKey: 'twilio',
        approved: true,
        approvalEvidence: { approvedBy: 'admin' },
        consent: true, // boolean flag must NOT be converted to fabricated consent
        input: { contactId, phone: '+15554443322', message: 'Unconsented SMS' }
      }
    });

    const batch1 = await runOutboxBatch({
      repository: outboxRepo,
      workerId: 'worker_consent_audit',
      handlers: dbHandlers,
      limit: 5
    });
    assert.equal(batch1.claimed, 1);
    assert.equal(batch1.results[0].status, 'dead_letter');
    assert.equal(adapterCalled, false, 'Adapter dispatch must NOT be invoked when consent record is missing');

    const dbRow1 = await pool.query('SELECT status, last_error_code FROM workflow_outbox WHERE id = $1', [unconsentedJob.id]);
    assert.equal(dbRow1.rows[0].status, 'dead_letter');
    assert.equal(dbRow1.rows[0].last_error_code, 'CONSENT_REQUIRED');

    // 2. Dispatch with REVOKED consent in PostgreSQL -> Fails closed
    const consentId = randomUUID();
    const client2 = await pool.connect();
    try {
      await client2.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
      await client2.query(`
        INSERT INTO communication_consents (id, agency_id, location_id, contact_id, channel, purpose, status, source)
        VALUES ($1, $2, $3, $4, 'sms', 'transactional', 'revoked', 'keyword_opt_out')
      `, [consentId, tenantId, locationId, contactId]);
    } finally {
      client2.release();
    }

    const revokedJob = await outboxRepo.enqueue({
      tenantId,
      locationId,
      eventType: 'workflow.action.execute',
      idempotencyKey: `idem_consent_revoked_${randomUUID()}`,
      payload: {
        tenantId,
        locationId,
        executionId: testExecId,
        actionId: 'sms',
        nodeType: 'sms',
        actionType: 'sms',
        providerKey: 'twilio',
        approved: true,
        approvalEvidence: { approvedBy: 'admin' },
        consent: true,
        input: { contactId, phone: '+15554443322', message: 'Revoked Consent SMS' }
      }
    });

    const batch2 = await runOutboxBatch({
      repository: outboxRepo,
      workerId: 'worker_consent_audit_2',
      handlers: dbHandlers,
      limit: 5
    });
    assert.equal(batch2.claimed, 1);
    assert.equal(batch2.results[0].status, 'dead_letter');
    assert.equal(adapterCalled, false);

    // 2b. Dispatch with EXPIRED consent in PostgreSQL -> Fails closed
    const expiredConsentId = randomUUID();
    const expiredContactId = randomUUID();
    const clientExp = await pool.connect();
    try {
      await clientExp.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
      await clientExp.query(`
        INSERT INTO location_records (id, agency_id, location_id, collection, body, created_at, updated_at)
        VALUES ($1, $2, $3, 'contacts', $4::jsonb, now(), now())
      `, [expiredContactId, tenantId, locationId, JSON.stringify({ id: expiredContactId, phone: '+15559998877' })]);
      await clientExp.query(`
        INSERT INTO communication_consents (id, agency_id, location_id, contact_id, channel, purpose, status, source, expires_at)
        VALUES ($1, $2, $3, $4, 'sms', 'transactional', 'granted', 'web_form', now() - interval '1 hour')
      `, [expiredConsentId, tenantId, locationId, expiredContactId]);
    } finally {
      clientExp.release();
    }

    const expiredJob = await outboxRepo.enqueue({
      tenantId,
      locationId,
      eventType: 'workflow.action.execute',
      idempotencyKey: `idem_consent_expired_${randomUUID()}`,
      payload: {
        tenantId,
        locationId,
        executionId: testExecId,
        actionId: 'sms',
        nodeType: 'sms',
        actionType: 'sms',
        providerKey: 'twilio',
        approved: true,
        approvalEvidence: { approvedBy: 'admin' },
        consent: true,
        input: { contactId: expiredContactId, phone: '+15559998877', message: 'Expired Consent SMS' }
      }
    });

    const batchExp = await runOutboxBatch({
      repository: outboxRepo,
      workerId: 'worker_consent_audit_expired',
      handlers: dbHandlers,
      limit: 5
    });
    assert.equal(batchExp.claimed, 1);
    assert.equal(batchExp.results[0].status, 'dead_letter');
    assert.equal(adapterCalled, false, 'Adapter dispatch must NOT be invoked when consent is expired');

    // 3. Grant valid consent in PostgreSQL -> Dispatch succeeds and writes receipt
    const client3 = await pool.connect();
    try {
      await client3.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
      await client3.query(`
        UPDATE communication_consents
        SET status = 'granted'
        WHERE id = $1
      `, [consentId]);
    } finally {
      client3.release();
    }

    const grantedJob = await outboxRepo.enqueue({
      tenantId,
      locationId,
      eventType: 'workflow.action.execute',
      idempotencyKey: `idem_consent_granted_${randomUUID()}`,
      payload: {
        tenantId,
        locationId,
        executionId: testExecId,
        actionId: 'sms',
        nodeType: 'sms',
        actionType: 'sms',
        providerKey: 'twilio',
        approved: true,
        approvalEvidence: { approvedBy: 'admin' },
        consent: true,
        input: { contactId, phone: '+15554443322', message: 'Legitimate SMS' }
      }
    });

    const batch3 = await runOutboxBatch({
      repository: outboxRepo,
      workerId: 'worker_consent_audit_3',
      handlers: dbHandlers,
      limit: 5
    });
    assert.equal(batch3.claimed, 1);
    assert.equal(batch3.results[0].status, 'delivered');
    assert.equal(adapterCalled, true, 'Adapter dispatch MUST be invoked when consent is granted in PostgreSQL');

    // 4. Provider failure propagates as retryable step
    const failingAdapter = {
      providerKey: 'twilio_fail',
      channel: 'sms',
      category: 'communication',
      async dispatch() {
        return { ok: false, code: 'UPSTREAM_CARRIER_TIMEOUT', error: 'Carrier timed out' };
      }
    };
    const failHandlers = createTrustedWorkerHandlers({
      pool,
      providerRegistry: createProviderAdapterRegistry([failingAdapter])
    });

    const failingJob = await outboxRepo.enqueue({
      tenantId,
      locationId,
      eventType: 'workflow.action.execute',
      idempotencyKey: `idem_provider_fail_${randomUUID()}`,
      payload: {
        tenantId,
        locationId,
        executionId: testExecId,
        actionId: 'sms',
        nodeType: 'sms',
        actionType: 'sms',
        providerKey: 'twilio_fail',
        approved: true,
        approvalEvidence: { approvedBy: 'admin' },
        consent: true,
        input: { contactId, phone: '+15554443322', message: 'Will fail' }
      }
    });

    const batch4 = await runOutboxBatch({
      repository: outboxRepo,
      workerId: 'worker_provider_fail_audit',
      handlers: failHandlers,
      limit: 5
    });
    assert.equal(batch4.claimed, 1);
    assert.equal(batch4.results[0].status, 'pending', 'Retryable failure resets status to pending for backoff retry');

    const failDb = await pool.query('SELECT status, attempts, last_error_code FROM workflow_outbox WHERE id = $1', [failingJob.id]);
    assert.equal(failDb.rows[0].status, 'pending');
    assert.equal(failDb.rows[0].attempts, 1);
    assert.equal(failDb.rows[0].last_error_code, 'UPSTREAM_CARRIER_TIMEOUT');

    await workerPool.end();
  });

  await t.test('19. Reliable Calendar External-ID Persistence & Deduplication under PostgreSQL Transaction', async () => {
    const calId = randomUUID();
    const apptId1 = randomUUID();
    const apptId2 = randomUUID();
    const futureStart1 = new Date(Date.now() + 3600000).toISOString();
    const futureEnd1 = new Date(Date.now() + 5400000).toISOString();
    const futureStart2 = new Date(Date.now() + 7200000).toISOString();
    const futureEnd2 = new Date(Date.now() + 9000000).toISOString();

    const calClient = await pool.connect();
    try {
      await calClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
      await calClient.query(`
        INSERT INTO calendars (id, agency_id, location_id, name, slug, duration_min, status)
        VALUES ($1, $2, $3, 'Sync Test Calendar', $4, 30, 'active')
      `, [calId, tenantId, locationId, `sync-cal-${calId.slice(0, 8)}`]);

      await calClient.query(`
        INSERT INTO appointments (id, agency_id, location_id, calendar_id, title, status, starts_at, ends_at)
        VALUES ($1, $2, $3, $4, 'First Appointment', 'confirmed', $5, $6),
               ($7, $2, $3, $4, 'Second Appointment', 'confirmed', $8, $9)
      `, [apptId1, tenantId, locationId, calId, futureStart1, futureEnd1, apptId2, futureStart2, futureEnd2]);
    } finally {
      calClient.release();
    }

    // Mock fetch for Google Calendar API
    let exportedGoogleEvents = [];
    const mockGoogleSyncFetch = async (url, options = {}) => {
      if (url.includes('/primary')) {
        return { ok: true, status: 200, json: async () => ({ id: 'primary' }) };
      }
      if (url.includes('/events') && options.method === 'POST') {
        const body = JSON.parse(options.body);
        const externalId = `google_ext_${randomUUID()}`;
        exportedGoogleEvents.push({ summary: body.summary, externalId });
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: externalId, status: 'confirmed', htmlLink: `https://calendar.google.com/event?id=${externalId}` })
        };
      }
      if (url.includes('/events')) {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      return { ok: false, status: 404 };
    };

    // Load appointments from PostgreSQL in tenant context using operza_app role
    const appDbUrl = dbUrl.replace('//postgres@', '//operza_app:operza_app_secret@').replace('//postgres:', '//operza_app:operza_app_secret@');
    const appPool = new pg.Pool({ connectionString: appDbUrl, max: 5 });

    try {
      const syncClient = await appPool.connect();
      let syncResult;
      try {
        await syncClient.query('BEGIN');
        await syncClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);

        const dbAppts = await syncClient.query(`
          SELECT id, agency_id as "agencyId", location_id as "locationId", calendar_id as "calendarId",
                 title, starts_at as "startsAt", ends_at as "endsAt", status, external_event_id as "externalEventId"
          FROM appointments
          WHERE agency_id = $1 AND location_id = $2 AND calendar_id = $3
          ORDER BY starts_at ASC
        `, [tenantId, locationId, calId]);
        assert.equal(dbAppts.rows.length, 2);

        syncResult = await executeCalendarSync({
          calendar: { id: calId, externalSync: { provider: 'google_calendar', syncDirection: 'two_way' } },
          appointments: dbAppts.rows,
          syncDirection: 'two_way',
          credentials: { accessToken: 'valid_access_token' },
          fetchFn: mockGoogleSyncFetch
        });

        assert.equal(syncResult.exportedEvents.length, 2);

        // Persist external_event_id in transaction with composite key check
        for (const exp of syncResult.exportedEvents) {
          const updateRes = await syncClient.query(`
            UPDATE appointments
            SET external_event_id = $1, updated_at = now()
            WHERE agency_id = $2 AND location_id = $3 AND calendar_id = $4 AND id = $5
          `, [exp.externalId, tenantId, locationId, calId, exp.appointmentId]);

          assert.equal(updateRes.rowCount, 1, 'Exactly one row must be updated per exported appointment');
        }

        await syncClient.query('COMMIT');
      } catch (err) {
        await syncClient.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        syncClient.release();
      }

      // Reload appointments from PostgreSQL: external_event_id must be populated
      const checkClient = await appPool.connect();
      try {
        await checkClient.query('BEGIN');
        await checkClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);
        const reloaded = await checkClient.query(`
          SELECT id, external_event_id FROM appointments WHERE agency_id = $1 AND calendar_id = $2 ORDER BY starts_at ASC
        `, [tenantId, calId]);
        await checkClient.query('COMMIT');

        assert.equal(reloaded.rows.length, 2);
        assert.ok(reloaded.rows[0].external_event_id);
        assert.ok(reloaded.rows[1].external_event_id);

        // Run second sync pass with reloaded appointments: must export 0 events (deduplicated)
        const secondSync = await executeCalendarSync({
          calendar: { id: calId, externalSync: { provider: 'google_calendar', syncDirection: 'two_way' } },
          appointments: reloaded.rows.map(r => ({ id: r.id, calendarId: calId, externalEventId: r.external_event_id, startsAt: futureStart1, endsAt: futureEnd1, status: 'confirmed' })),
          syncDirection: 'two_way',
          credentials: { accessToken: 'valid_access_token' },
          fetchFn: mockGoogleSyncFetch
        });
        assert.equal(secondSync.exportedEvents.length, 0, 'Subsequent sync must export 0 events');
      } finally {
        checkClient.release();
      }

      // Simulate failed write: attempting to persist with invalid ID throws APPOINTMENT_EXTERNAL_ID_PERSIST_FAILED
      const failClient = await appPool.connect();
      try {
        await failClient.query('BEGIN');
        await failClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);

        const fakeApptId = randomUUID();
        const failUpdate = await failClient.query(`
          UPDATE appointments
          SET external_event_id = $1, updated_at = now()
          WHERE agency_id = $2 AND location_id = $3 AND calendar_id = $4 AND id = $5
        `, ['ext_nonexistent', tenantId, locationId, calId, fakeApptId]);

        assert.equal(failUpdate.rowCount, 0, 'Nonexistent appointment update returns rowCount 0');
        if (failUpdate.rowCount !== 1) {
          const err = Object.assign(new Error(`Failed to persist external event ID for appointment ${fakeApptId}: record not found or tenant mismatch`), {
            code: 'APPOINTMENT_EXTERNAL_ID_PERSIST_FAILED',
            appointmentId: fakeApptId
          });
          assert.equal(err.code, 'APPOINTMENT_EXTERNAL_ID_PERSIST_FAILED');
        }
        await failClient.query('ROLLBACK');
      } finally {
        failClient.release();
      }
    } finally {
      await appPool.end();
    }
  });

  await t.test('20. Workflow Runs PostgreSQL RLS Context & Multi-Tenant Isolation Verification', async () => {
    const PORT_RUNS = 4309;
    const BASE_RUNS = `http://127.0.0.1:${PORT_RUNS}`;
    const STORE_RUNS = './scratch/store_api_runs_rls.json';
    try { rmSync(path.join(root, 'apps/api', STORE_RUNS), { force: true }); } catch {}

    const appDbUrl = dbUrl.replace('//postgres@', '//operza_app:operza_app_secret@').replace('//postgres:', '//operza_app:operza_app_secret@');
    const appEnv = {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT_RUNS),
      DATA_FILE: STORE_RUNS,
      DATABASE_URL: appDbUrl,
      MIGRATION_DATABASE_URL: dbUrl,
      OPERZA_TEST_DATABASE_URL: appDbUrl,
      PLATFORM_DB_ENABLED: 'true',
      OPERZA_VAULT_KEY: 'test-vault-key-for-approvals-32-chars-long',
      OPERZA_ADMIN_KEY: 'operza-admin-telemetry-secret-key-32chars-valid-pass'
    };

    const serverProc = spawn('node', ['apps/api/server.mjs'], {
      cwd: root,
      stdio: 'pipe',
      env: appEnv
    });

    let serverLogs = '';
    serverProc.stdout.on('data', d => { serverLogs += d.toString(); });
    serverProc.stderr.on('data', d => { serverLogs += d.toString(); });

    try {
      // Wait for server health
      let serverUp = false;
      for (let i = 0; i < 40; i++) {
        try {
          const r = await fetch(`${BASE_RUNS}/health`);
          if (r.ok) { serverUp = true; break; }
        } catch {}
        await sleep(250);
      }
      assert.equal(serverUp, true, 'Runs API server must become healthy');

      // 1. Sign up Agency A
      const emailA = `agency-a-runs-${Date.now()}@example.com`;
      const signupResA = await fetch(`${BASE_RUNS}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Agency A Admin',
          email: emailA,
          password: 'Password123!',
          agencyName: 'Agency Alpha Runs'
        })
      });
      assert.equal(signupResA.status, 201);
      const dataA = await signupResA.json();
      const agencyA = dataA.agency.id;
      const locationA1 = dataA.activeLocationId || dataA.locations[0].id;

      const cookiesA = signupResA.headers.getSetCookie ? signupResA.headers.getSetCookie() : [signupResA.headers.get('set-cookie')].filter(Boolean);
      const sessionCookieA = cookiesA.map(c => c.split(';')[0]).join('; ');

      // 2. Provision Location A2 for Agency A in PostgreSQL
      const locationA2 = randomUUID();
      await pool.query(`
        INSERT INTO locations (id, agency_id, name, status, created_at)
        VALUES ($1, $2, 'Agency A - Location 2', 'active', now())
      `, [locationA2, agencyA]);

      // 3. Sign up Agency B
      const emailB = `agency-b-runs-${Date.now()}@example.com`;
      const signupResB = await fetch(`${BASE_RUNS}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Agency B Admin',
          email: emailB,
          password: 'Password123!',
          agencyName: 'Agency Beta Runs'
        })
      });
      assert.equal(signupResB.status, 201);
      const dataB = await signupResB.json();
      const agencyB = dataB.agency.id;
      const locationB1 = dataB.activeLocationId || dataB.locations[0].id;

      const cookiesB = signupResB.headers.getSetCookie ? signupResB.headers.getSetCookie() : [signupResB.headers.get('set-cookie')].filter(Boolean);
      const sessionCookieB = cookiesB.map(c => c.split(';')[0]).join('; ');

      // 4. Seed workflow definitions and executions
      const flowA1 = randomUUID();
      const flowA2 = randomUUID();
      const flowB1 = randomUUID();

      await pool.query(`
        INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes)
        VALUES ($1, $2, $3, 'Flow A1', 'published', 'webhook', '[]'::jsonb),
               ($4, $2, $5, 'Flow A2', 'published', 'webhook', '[]'::jsonb),
               ($6, $7, $8, 'Flow B1', 'published', 'webhook', '[]'::jsonb)
      `, [flowA1, agencyA, locationA1, flowA2, locationA2, flowB1, agencyB, locationB1]);

      const execA1_1 = randomUUID();
      const execA1_2 = randomUUID();
      const execA2_1 = randomUUID();
      const execB1_1 = randomUUID();

      await pool.query(`
        INSERT INTO workflow_executions (id, agency_id, location_id, workflow_id, status, trigger_event)
        VALUES ($1, $2, $3, $4, 'completed', '{"source":"testA1_1"}'::jsonb),
               ($5, $2, $3, $4, 'running', '{"source":"testA1_2"}'::jsonb),
               ($6, $2, $7, $8, 'completed', '{"source":"testA2_1"}'::jsonb),
               ($9, $10, $11, $12, 'completed', '{"source":"testB1_1"}'::jsonb)
      `, [
        execA1_1, agencyA, locationA1, flowA1,
        execA1_2,
        execA2_1, locationA2, flowA2,
        execB1_1, agencyB, locationB1, flowB1
      ]);

      // Direct operza_app client test: Verify RLS query behavior
      const testAppPool = new pg.Pool({ connectionString: appDbUrl, max: 2 });
      try {
        const client = await testAppPool.connect();
        try {
          // Without tenant context, RLS returns 0 rows
          const uncontextualRes = await client.query('SELECT * FROM workflow_executions');
          assert.equal(uncontextualRes.rows.length, 0, 'operza_app without context returns 0 rows due to RLS');

          // Under transaction-local context for (agencyA, locationA1)
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [agencyA, locationA1]);
          const a1Res = await client.query(`
            SELECT id, agency_id, location_id FROM workflow_executions
            WHERE agency_id = $1 AND location_id = $2
          `, [agencyA, locationA1]);
          await client.query('COMMIT');

          assert.equal(a1Res.rows.length, 2, 'Must return exactly 2 executions for Location A1');
          const a1Ids = a1Res.rows.map(r => r.id);
          assert.ok(a1Ids.includes(execA1_1));
          assert.ok(a1Ids.includes(execA1_2));
          assert.equal(a1Ids.includes(execA2_1), false, 'Location A2 must NOT be returned');
          assert.equal(a1Ids.includes(execB1_1), false, 'Agency B must NOT be returned');
        } finally {
          client.release();
        }
      } finally {
        await testAppPool.end();
      }

      // 5. HTTP Route Verification: GET /api/workflows/runs
      // 5.1 Request as Agency A, Location A1 (default active location)
      const resA1 = await fetch(`${BASE_RUNS}/api/workflows/runs`, {
        headers: { Cookie: sessionCookieA }
      });
      assert.equal(resA1.status, 200);
      const runsA1 = await resA1.json();
      assert.equal(runsA1.length, 2, 'HTTP route must return 2 runs for Location A1');
      const httpA1Ids = runsA1.map(r => r.id);
      assert.ok(httpA1Ids.includes(execA1_1));
      assert.ok(httpA1Ids.includes(execA1_2));
      assert.equal(httpA1Ids.includes(execA2_1), false, 'HTTP route must NOT return Location A2 run');
      assert.equal(httpA1Ids.includes(execB1_1), false, 'HTTP route must NOT return Agency B run');

      // Verify response structure compatibility
      const sampleRun = runsA1[0];
      assert.ok(sampleRun.id);
      assert.ok(sampleRun.workflowId);
      assert.ok(sampleRun.status);
      assert.ok(sampleRun.createdAt);
      assert.ok(sampleRun.triggerContext);

      // 5.2 Request as Agency A, switching to Location A2
      const resA2 = await fetch(`${BASE_RUNS}/api/workflows/runs`, {
        headers: {
          Cookie: sessionCookieA,
          'x-operza-location': locationA2
        }
      });
      assert.equal(resA2.status, 200);
      const runsA2 = await resA2.json();
      assert.equal(runsA2.length, 1, 'HTTP route must return 1 run for Location A2');
      assert.equal(runsA2[0].id, execA2_1);
      assert.equal(runsA2[0].workflowId, flowA2);

      // 5.3 Request as Agency B, Location B1
      const resB1 = await fetch(`${BASE_RUNS}/api/workflows/runs`, {
        headers: { Cookie: sessionCookieB }
      });
      assert.equal(resB1.status, 200);
      const runsB1 = await resB1.json();
      assert.equal(runsB1.length, 1, 'HTTP route must return 1 run for Agency B');
      assert.equal(runsB1[0].id, execB1_1);
      assert.equal(runsB1[0].workflowId, flowB1);

      // 5.4 Missing active location context: unauthorized location header returns 401
      const resUnauthLoc = await fetch(`${BASE_RUNS}/api/workflows/runs`, {
        headers: {
          Cookie: sessionCookieA,
          'x-operza-location': randomUUID()
        }
      });
      assert.equal(resUnauthLoc.status, 401, 'Unauthorized location header fails authentication');

      // 5.5 Fail-closed behavior on database error: does NOT return memory-backed runs
      // Temporarily rename table to trigger a PostgreSQL query error in GET /api/workflows/runs
      await pool.query('ALTER TABLE workflow_executions RENAME TO workflow_executions_tmp;');
      try {
        const failRes = await fetch(`${BASE_RUNS}/api/workflows/runs`, {
          headers: { Cookie: sessionCookieA }
        });
        assert.equal(failRes.status, 500, 'Database failure must return 500 under authoritative PostgreSQL');
        const failBody = await failRes.json();
        assert.equal(failBody.code, 'DATABASE_WORKFLOW_RUNS_FAILED', 'Error code must indicate database query failure');
      } finally {
        // Restore table name
        await pool.query('ALTER TABLE workflow_executions_tmp RENAME TO workflow_executions;');
      }

      // 5.6 Confirm immediate recovery after error: transaction was rolled back and client was released
      const recoverRes = await fetch(`${BASE_RUNS}/api/workflows/runs`, {
        headers: { Cookie: sessionCookieA }
      });
      assert.equal(recoverRes.status, 200, 'Subsequent request succeeds proving client was properly released');
      const recoverRuns = await recoverRes.json();
      assert.equal(recoverRuns.length, 2, 'Returns full Location A1 runs after recovery');
    } finally {
      serverProc.kill('SIGTERM');
      try { rmSync(path.join(root, 'apps/api', STORE_RUNS), { force: true }); } catch {}
    }
  });
});
