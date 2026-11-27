import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { IsolatedTestPostgres } from '../../db/lib/test-postgres-server.mjs';
import { runInTenantTx } from '../../db/lib/tenant-tx.mjs';
import { createWorkflowOperationsRepository } from '../../db/lib/workflow-operations-repository.mjs';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

test('Workflow Operations 2.0: PostgreSQL Migration 050, FORCE RLS Tenant Isolation, Safe Retry, DLQ & Recovery', async (t) => {
  let pgServer = null;
  let adminPool = null;
  let appPool = null;
  let dbUrl = process.env.OPERZA_TEST_DATABASE_URL;

  if (!dbUrl) {
    try {
      pgServer = new IsolatedTestPostgres({ port: 0, dbName: 'operza_workflow_ops_2_test' });
      dbUrl = await pgServer.start();
    } catch (err) {
      t.skip(`PostgreSQL isolated server unavailable: ${err.message}`);
      return;
    }
  }

  try {
    adminPool = new Pool({ connectionString: dbUrl });
    const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await adminPool.query(sql);
    }

    // Ensure operza_app role exists for real FORCE RLS testing
    await adminPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
          CREATE ROLE operza_app LOGIN PASSWORD 'operza_app_test_pw';
        END IF;
      END $$;
    `);
    await adminPool.query(`GRANT USAGE ON SCHEMA public TO operza_app`);
    await adminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO operza_app`);

    const parsed = new URL(dbUrl);
    parsed.username = 'operza_app';
    parsed.password = 'operza_app_test_pw';
    appPool = new Pool({ connectionString: parsed.toString() });

    const agencyA = randomUUID();
    const locA = randomUUID();
    const agencyB = randomUUID();
    const locB = randomUUID();
    const wfA = randomUUID();
    const execFailA = randomUUID();
    const execDlqA = randomUUID();
    const execStuckA = randomUUID();

    // Seed agencies, locations, workflow, and executions as admin
    await adminPool.query(`INSERT INTO agencies (id, name, slug) VALUES ($1, 'Agency A', $2), ($3, 'Agency B', $4)`, [
      agencyA, `ag-a-${agencyA.slice(0, 6)}`, agencyB, `ag-b-${agencyB.slice(0, 6)}`
    ]);
    await adminPool.query(`INSERT INTO locations (id, agency_id, name) VALUES ($1, $2, 'Loc A'), ($3, $4, 'Loc B')`, [
      locA, agencyA, locB, agencyB
    ]);
    await adminPool.query(
      `INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
       VALUES ($1, $2, $3, 'Ops Test Flow', 'published', 'manual', $4::jsonb, 3)`,
      [wfA, agencyA, locA, JSON.stringify([{ id: 'n1', kind: 'email', label: 'Send Welcome' }])]
    );

    // 1. Failed execution with external side-effect step
    await adminPool.query(
      `INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, workflow_name, workflow_version, status,
        trigger_type, attempts, attempt_count, max_attempts, last_error_code, failure_category,
        failure_message, retryable, correlation_id, created_at
      ) VALUES ($1, $2, $3, $4, 'Ops Test Flow', 3, 'failed', 'manual', 1, 1, 3, 'ETIMEDOUT', 'transient_network', 'Socket timeout', true, 'corr_1', now())`,
      [execFailA, agencyA, locA, wfA]
    );
    await adminPool.query(
      `INSERT INTO workflow_execution_steps (
        id, agency_id, location_id, execution_id, node_id, node_type, node_name, execution_order, attempt, status, error_code
      ) VALUES ($1, $2, $3, $4, 'n1', 'email', 'Send Welcome', 1, 1, 'failed', 'ETIMEDOUT')`,
      [randomUUID(), agencyA, locA, execFailA]
    );

    // 2. Dead-letter execution
    await adminPool.query(
      `INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, workflow_name, workflow_version, status,
        trigger_type, attempts, attempt_count, max_attempts, last_error_code, failure_category,
        failure_message, retryable, dead_lettered_at, dead_letter_reason, correlation_id, created_at
      ) VALUES ($1, $2, $3, $4, 'Ops Test Flow', 3, 'dead_letter', 'webhook', 3, 3, 3, 'SERVICE_UNAVAILABLE', 'provider_outage', '503 upstream', true, now(), 'Max attempts exhausted', 'corr_2', now())`,
      [execDlqA, agencyA, locA, wfA]
    );

    // 3. Stuck execution (expired lease)
    await adminPool.query(
      `INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, workflow_name, workflow_version, status,
        trigger_type, attempts, attempt_count, max_attempts, worker_lease_id, lease_expires_at, heartbeat_at, correlation_id, created_at
      ) VALUES ($1, $2, $3, $4, 'Ops Test Flow', 3, 'running', 'schedule', 1, 1, 3, 'worker-dead', now() - interval '120 seconds', now() - interval '120 seconds', 'corr_3', now() - interval '180 seconds')`,
      [execStuckA, agencyA, locA, wfA]
    );

    const opsRepo = createWorkflowOperationsRepository();

    // Verify Tenant B cannot see Tenant A's runs or DLQ under FORCE RLS (operza_app)
    const tenantBRuns = await runInTenantTx(appPool, { agencyId: agencyB, locationId: locB, actorId: 'op_b' }, tx =>
      opsRepo.listOperationalRuns(tx, {})
    );
    assert.equal(tenantBRuns.total, 0);

    const tenantBDetail = await runInTenantTx(appPool, { agencyId: agencyB, locationId: locB, actorId: 'op_b' }, tx =>
      opsRepo.getOperationalRunDetail(tx, execFailA)
    );
    assert.equal(tenantBDetail, null);

    // Verify Tenant A operational metrics
    const metricsA = await runInTenantTx(appPool, { agencyId: agencyA, locationId: locA, actorId: 'op_a' }, tx =>
      opsRepo.getOperationalMetrics(tx, {})
    );
    assert.equal(metricsA.totalExecutions, 3);
    assert.equal(metricsA.failedCount, 1);
    assert.equal(metricsA.deadLetterCount, 1);
    assert.equal(metricsA.runningCount, 1);
    assert.equal(metricsA.stuckCount, 1);

    // Verify side-effect confirmation is required on execFailA
    const unconfirmed = await runInTenantTx(appPool, { agencyId: agencyA, locationId: locA, actorId: 'op_a' }, tx =>
      opsRepo.retryOrRequeueExecution(tx, { executionId: execFailA, actorId: 'op1', confirmSideEffectRetry: false })
    );
    assert.equal(unconfirmed.confirmationRequired, true);
    assert.equal(unconfirmed.code, 'SIDE_EFFECT_CONFIRMATION_REQUIRED');

    // Confirmed retry preserves version 3 and creates attempt record
    const confirmed = await runInTenantTx(appPool, { agencyId: agencyA, locationId: locA, actorId: 'op_a' }, tx =>
      opsRepo.retryOrRequeueExecution(tx, { executionId: execFailA, actorId: 'op1', confirmSideEffectRetry: true })
    );
    assert.equal(confirmed.success, true);
    assert.equal(confirmed.execution.status, 'enqueued');
    assert.equal(confirmed.execution.workflowVersion, 3);
    assert.equal(confirmed.execution.attemptCount, 2);

    // DLQ requeue + duplicate requeue prevention
    const requeued = await runInTenantTx(appPool, { agencyId: agencyA, locationId: locA, actorId: 'op_a' }, tx =>
      opsRepo.retryOrRequeueExecution(tx, { executionId: execDlqA, actorId: 'op1', targetMode: 'requeue', confirmSideEffectRetry: true })
    );
    assert.equal(requeued.success, true);
    assert.equal(requeued.execution.requeueCount, 1);

    const duplicateRequeue = await runInTenantTx(appPool, { agencyId: agencyA, locationId: locA, actorId: 'op_a' }, tx =>
      opsRepo.retryOrRequeueExecution(tx, { executionId: execDlqA, actorId: 'op1', targetMode: 'requeue', confirmSideEffectRetry: true })
    );
    assert.equal(duplicateRequeue.conflict, true);
    assert.equal(duplicateRequeue.code, 'NOT_DEAD_LETTERED');

    // Stuck execution recovery
    const recovery = await runInTenantTx(appPool, { agencyId: agencyA, locationId: locA, actorId: 'op_a' }, tx =>
      opsRepo.recoverStuckExecutionsInDb(tx, { actorId: 'op1' })
    );
    assert.equal(recovery.recoveredCount, 1);
    assert.equal(recovery.recovered[0].executionId, execStuckA);

    // Pause and resume workflow
    const paused = await runInTenantTx(appPool, { agencyId: agencyA, locationId: locA, actorId: 'op_a' }, tx =>
      opsRepo.setWorkflowStatus(tx, { workflowId: wfA, targetStatus: 'paused', actorId: 'op1' })
    );
    assert.equal(paused.workflow.status, 'paused');

    const resumed = await runInTenantTx(appPool, { agencyId: agencyA, locationId: locA, actorId: 'op_a' }, tx =>
      opsRepo.setWorkflowStatus(tx, { workflowId: wfA, targetStatus: 'published', actorId: 'op1' })
    );
    assert.equal(resumed.workflow.status, 'published');
  } finally {
    if (appPool) await appPool.end().catch(() => {});
    if (adminPool) await adminPool.end().catch(() => {});
    if (pgServer) await pgServer.stop().catch(() => {});
  }
});
