import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createWorkflowOutboxRepository } from '../../../packages/db/lib/outbox-repository.mjs';
import { produceWorkflowTriggerEvent, produceWorkflowResumeEvent, produceConnectorActionEvent } from '../../../packages/platform-core/src/outbox-producer.mjs';
import { trustedWorkerHandlers } from '../../../packages/platform-core/src/trusted-handlers.mjs';
import { runOutboxBatch } from '../../../packages/platform-core/src/durable-worker.mjs';
import { IsolatedTestPostgres } from '../../../packages/db/lib/test-postgres-server.mjs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

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
});
