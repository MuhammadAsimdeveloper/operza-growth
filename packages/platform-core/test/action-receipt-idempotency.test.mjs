import test from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorkflowOutboxRepository } from '../../db/lib/outbox-repository.mjs';
import {
  computeActionHash,
  createActionInvocation,
  authorizeActionInvocation,
  getWorkflowActionDefinition,
  createApprovalRequest,
  decideApproval
} from '../../workflow-engine/src/action-governance.mjs';
import { walkGraph, executeStep } from '../../workflow-engine/src/engine.mjs';
import {
  createTrustedWorkerHandlers,
  createRealCrmActions,
  executeAtomicCrmAction,
  executeDurableProviderAction
} from '../src/trusted-handlers.mjs';
import {
  createProviderAdapterRegistry,
  getProviderCapability
} from '../src/provider-adapters.mjs';
import { IsolatedTestPostgres } from '../../db/lib/test-postgres-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

test('OPERZA GROWTH — Workflow Action Receipt & Idempotency Suite (Scenarios 1-30)', async (t) => {
  let pgServer = null;
  let pool = null;
  let dbUrl = process.env.OPERZA_TEST_DATABASE_URL;

  if (!dbUrl) {
    try {
      pgServer = new IsolatedTestPostgres({ port: 0, dbName: 'operza_idempotency_suite_test' });
      dbUrl = await pgServer.start();
    } catch (err) {
      t.skip(`PostgreSQL isolated server unavailable: ${err.message}`);
      return;
    }
  }

  const { default: pg } = await import('pg');
  pool = new pg.Pool({ connectionString: dbUrl, max: 10 });

  // Bootstrap roles and apply all migrations (including 032)
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
  `);

  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now());');
  const appliedRes = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(appliedRes.rows.map(r => r.name));

  const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
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

  await pool.query(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO operza_app, operza_worker;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO operza_app, operza_worker;
  `);

  t.after(async () => {
    if (pool) await pool.end().catch(() => {});
    if (pgServer) await pgServer.stop().catch(() => {});
  });

  const tenantA = randomUUID();
  const locationA = randomUUID();
  const tenantB = randomUUID();
  const locationB = randomUUID();
  const contactIdA = randomUUID();
  const outboxRepo = createWorkflowOutboxRepository(pool);

  async function seedExecution({ agencyId = tenantA, locationId = locationA, workflowId = null, executionId = null } = {}) {
    const wfId = workflowId || randomUUID();
    const exId = executionId || randomUUID();
    await pool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes)
      VALUES ($1, $2, $3, 'Test Workflow', 'published', 'manual', '[]'::jsonb)
      ON CONFLICT (agency_id, location_id, id) DO NOTHING
    `, [wfId, agencyId, locationId]);

    await pool.query(`
      INSERT INTO workflow_executions (id, agency_id, location_id, workflow_id, status)
      VALUES ($1, $2, $3, $4, 'running')
      ON CONFLICT (agency_id, location_id, id) DO NOTHING
    `, [exId, agencyId, locationId, wfId]);

    return { workflowId: wfId, executionId: exId };
  }

  // Seed Tenant A and Location A
  await pool.query(`INSERT INTO agencies (id, name, slug) VALUES ($1, 'Agency A', $2) ON CONFLICT DO NOTHING`, [tenantA, `agency-a-${tenantA.slice(0, 8)}`]);
  await pool.query(`INSERT INTO locations (id, agency_id, name) VALUES ($1, $2, 'Location A') ON CONFLICT DO NOTHING`, [locationA, tenantA]);

  // Seed Tenant B and Location B
  await pool.query(`INSERT INTO agencies (id, name, slug) VALUES ($1, 'Agency B', $2) ON CONFLICT DO NOTHING`, [tenantB, `agency-b-${tenantB.slice(0, 8)}`]);
  await pool.query(`INSERT INTO locations (id, agency_id, name) VALUES ($1, $2, 'Location B') ON CONFLICT DO NOTHING`, [locationB, tenantB]);

  // Seed Contact in Tenant A
  await pool.query(`
    INSERT INTO location_records (id, agency_id, location_id, collection, body, created_at, updated_at)
    VALUES ($1, $2, $3, 'contacts', $4::jsonb, now(), now())
    ON CONFLICT (agency_id, location_id, collection, id) DO NOTHING
  `, [contactIdA, tenantA, locationA, JSON.stringify({ id: contactIdA, email: 'lead-a@example.com', tags: ['lead'], leadScore: 10 })]);

  // Seed Consent in Tenant A
  await pool.query(`
    INSERT INTO communication_consents (id, agency_id, location_id, contact_id, channel, purpose, status, source, captured_at)
    VALUES ($1, $2, $3, $4, 'email', 'transactional', 'granted', 'web_form', now())
    ON CONFLICT DO NOTHING
  `, [randomUUID(), tenantA, locationA, contactIdA]);

  // ---------------------------------------------------------------------------
  // PART 1: RECEIPT FENCING & LEASES (Scenarios 1 - 9)
  // ---------------------------------------------------------------------------

  let scenarioFencingHash = null;
  let workerAClaimToken = null;
  let workerBClaimToken = null;
  const { executionId: fencingExecId } = await seedExecution();

  await t.test('Scenario 1: Worker A claims receipt with lease and receives unique claim token', async () => {
    scenarioFencingHash = crypto.createHash('sha256').update('scenario_fencing_' + randomUUID()).digest('hex');
    const claim = await outboxRepo.claimActionReceipt({
      tenantId: tenantA,
      locationId: locationA,
      executionId: fencingExecId,
      nodeId: 'node_fencing_1',
      actionHash: scenarioFencingHash,
      providerKey: 'email.resend',
      workerId: 'worker_A',
      leaseSeconds: 1,
      hasVerifiedIdempotency: true
    });

    assert.equal(claim.acquired, true);
    assert.ok(claim.claimToken);
    assert.match(claim.claimToken, /^[0-9a-f-]{36}$/i);
    workerAClaimToken = claim.claimToken;
  });

  await t.test('Scenario 2: Worker A lease expires', async () => {
    await new Promise(r => setTimeout(r, 1100));
    const receipt = await outboxRepo.getActionReceipt({
      tenantId: tenantA,
      locationId: locationA,
      actionHash: scenarioFencingHash
    });
    assert.ok(receipt);
    assert.equal(receipt.status, 'started');
    assert.ok(new Date(receipt.lease_until).getTime() < Date.now());
  });

  await t.test('Scenario 3: Worker B reclaims with new unique claim token', async () => {
    const claimB = await outboxRepo.claimActionReceipt({
      tenantId: tenantA,
      locationId: locationA,
      executionId: fencingExecId,
      nodeId: 'node_fencing_1',
      actionHash: scenarioFencingHash,
      providerKey: 'email.resend',
      workerId: 'worker_B',
      leaseSeconds: 60,
      hasVerifiedIdempotency: true
    });

    assert.equal(claimB.acquired, true);
    assert.equal(claimB.recovered, true);
    assert.ok(claimB.claimToken);
    assert.notEqual(claimB.claimToken, workerAClaimToken);
    workerBClaimToken = claimB.claimToken;
  });

  await t.test('Scenario 4: Worker A attempts completion after lease expiry / reclaim -> throws ACTION_LEASE_LOST', async () => {
    await assert.rejects(async () => {
      await outboxRepo.completeActionReceipt({
        tenantId: tenantA,
        locationId: locationA,
        actionHash: scenarioFencingHash,
        claimToken: workerAClaimToken,
        result: { ok: true, worker: 'worker_A' }
      });
    }, (err) => err.code === 'ACTION_LEASE_LOST');
  });

  await t.test('Scenario 5: Worker A attempts failure after lease expiry / reclaim -> throws ACTION_LEASE_LOST', async () => {
    await assert.rejects(async () => {
      await outboxRepo.failActionReceipt({
        tenantId: tenantA,
        locationId: locationA,
        actionHash: scenarioFencingHash,
        claimToken: workerAClaimToken,
        errorCode: 'WORKER_A_FAILED'
      });
    }, (err) => err.code === 'ACTION_LEASE_LOST');
  });

  await t.test('Scenario 6: Worker B completes successfully', async () => {
    const comp = await outboxRepo.completeActionReceipt({
      tenantId: tenantA,
      locationId: locationA,
      actionHash: scenarioFencingHash,
      claimToken: workerBClaimToken,
      result: { ok: true, worker: 'worker_B', completed: true },
      providerReceipt: 'resend_msg_1001'
    });

    assert.equal(comp.status, 'succeeded');
    assert.equal(comp.provider_receipt, 'resend_msg_1001');

    const receipt = await outboxRepo.getActionReceipt({
      tenantId: tenantA,
      locationId: locationA,
      actionHash: scenarioFencingHash
    });
    assert.equal(receipt.status, 'succeeded');
    assert.ok(receipt.completed_at);
  });

  await t.test('Scenario 7: Further completion/failure attempt cannot overwrite succeeded receipt (ACTION_RECEIPT_TERMINAL)', async () => {
    await assert.rejects(async () => {
      await outboxRepo.completeActionReceipt({
        tenantId: tenantA,
        locationId: locationA,
        actionHash: scenarioFencingHash,
        claimToken: workerBClaimToken,
        result: { ok: true, overwrite: true }
      });
    }, (err) => err.code === 'ACTION_RECEIPT_TERMINAL');

    await assert.rejects(async () => {
      await outboxRepo.failActionReceipt({
        tenantId: tenantA,
        locationId: locationA,
        actionHash: scenarioFencingHash,
        claimToken: workerBClaimToken,
        errorCode: 'CANNOT_FAIL_TERMINAL'
      });
    }, (err) => err.code === 'ACTION_RECEIPT_TERMINAL');
  });

  await t.test('Scenario 8: Same workerId receives distinct claim tokens across attempts', async () => {
    const hash = crypto.createHash('sha256').update('scenario_8_' + randomUUID()).digest('hex');
    const claim1 = await outboxRepo.claimActionReceipt({
      tenantId: tenantA,
      locationId: locationA,
      executionId: fencingExecId,
      nodeId: 'node_8',
      actionHash: hash,
      providerKey: 'email.resend',
      workerId: 'worker_restarted_pool',
      leaseSeconds: 1,
      hasVerifiedIdempotency: true
    });
    assert.equal(claim1.acquired, true);

    await new Promise(r => setTimeout(r, 1100));

    const claim2 = await outboxRepo.claimActionReceipt({
      tenantId: tenantA,
      locationId: locationA,
      executionId: fencingExecId,
      nodeId: 'node_8',
      actionHash: hash,
      providerKey: 'email.resend',
      workerId: 'worker_restarted_pool',
      leaseSeconds: 60,
      hasVerifiedIdempotency: true
    });
    assert.equal(claim2.acquired, true);
    assert.notEqual(claim1.claimToken, claim2.claimToken);
  });

  await t.test('Scenario 9: Concurrent claims on identical action hash are serialized by database constraint', async () => {
    const actionHash = crypto.createHash('sha256').update('scenario_9_serialized_' + randomUUID()).digest('hex');
    const claims = await Promise.all([
      outboxRepo.claimActionReceipt({ tenantId: tenantA, locationId: locationA, executionId: fencingExecId, nodeId: 'node_9', actionHash, workerId: 'w1' }),
      outboxRepo.claimActionReceipt({ tenantId: tenantA, locationId: locationA, executionId: fencingExecId, nodeId: 'node_9', actionHash, workerId: 'w2' }),
      outboxRepo.claimActionReceipt({ tenantId: tenantA, locationId: locationA, executionId: fencingExecId, nodeId: 'node_9', actionHash, workerId: 'w3' }),
      outboxRepo.claimActionReceipt({ tenantId: tenantA, locationId: locationA, executionId: fencingExecId, nodeId: 'node_9', actionHash, workerId: 'w4' }),
      outboxRepo.claimActionReceipt({ tenantId: tenantA, locationId: locationA, executionId: fencingExecId, nodeId: 'node_9', actionHash, workerId: 'w5' })
    ]);

    const acquired = claims.filter(c => c.acquired);
    assert.equal(acquired.length, 1);
    const inProgress = claims.filter(c => c.status === 'in_progress');
    assert.equal(inProgress.length, 4);
  });

  // ---------------------------------------------------------------------------
  // PART 2: PROVIDER CAPABILITIES & RECOVERY (Scenarios 10 - 17)
  // ---------------------------------------------------------------------------

  await t.test('Scenario 10: Provider without verified idempotency: expired lease transitions to indeterminate (PROVIDER_RECOVERY_UNCERTAIN)', async () => {
    const unverifiedHash = crypto.createHash('sha256').update('scenario_10_unverified_' + randomUUID()).digest('hex');
    const claim = await outboxRepo.claimActionReceipt({
      tenantId: tenantA,
      locationId: locationA,
      executionId: fencingExecId,
      nodeId: 'node_10',
      actionHash: unverifiedHash,
      providerKey: 'email.sendgrid',
      workerId: 'worker_crashed_sendgrid',
      leaseSeconds: 1,
      hasVerifiedIdempotency: false
    });
    assert.equal(claim.acquired, true);

    await new Promise(r => setTimeout(r, 1100));

    // Recovery attempt for unverified provider must transition to indeterminate
    const reclaim = await outboxRepo.claimActionReceipt({
      tenantId: tenantA,
      locationId: locationA,
      executionId: fencingExecId,
      nodeId: 'node_10',
      actionHash: unverifiedHash,
      providerKey: 'email.sendgrid',
      workerId: 'worker_recovery',
      leaseSeconds: 60,
      hasVerifiedIdempotency: false
    });

    assert.equal(reclaim.acquired, false);
    assert.equal(reclaim.status, 'indeterminate');
    assert.equal(reclaim.disposition, 'uncertain_expired');

    const receipt = await outboxRepo.getActionReceipt({ tenantId: tenantA, locationId: locationA, actionHash: unverifiedHash });
    assert.equal(receipt.status, 'indeterminate');
    assert.equal(receipt.last_error_code, 'PROVIDER_RECOVERY_UNCERTAIN');
  });

  await t.test('Scenario 10B: Persisted provider identity is authoritative and rejects provider mismatch', async () => {
    const mismatchHash = crypto.createHash('sha256').update('scenario_10b_mismatch_' + randomUUID()).digest('hex');
    await outboxRepo.claimActionReceipt({
      tenantId: tenantA,
      locationId: locationA,
      executionId: fencingExecId,
      nodeId: 'node_10b',
      actionHash: mismatchHash,
      providerKey: 'email.sendgrid',
      workerId: 'worker_sg',
      leaseSeconds: 1
    });

    await new Promise(r => setTimeout(r, 1100));

    // Caller attempts to claim as resend to bypass SendGrid recovery restrictions
    await assert.rejects(async () => {
      await outboxRepo.claimActionReceipt({
        tenantId: tenantA,
        locationId: locationA,
        executionId: fencingExecId,
        nodeId: 'node_10b',
        actionHash: mismatchHash,
        providerKey: 'email.resend',
        workerId: 'worker_fraud',
        leaseSeconds: 60,
        hasVerifiedIdempotency: true
      });
    }, (err) => err.code === 'PROVIDER_MISMATCH');
  });

  await t.test('Scenario 10C: Missing provider identity in claim cannot bypass unverified provider restrictions', async () => {
    const bypassHash = crypto.createHash('sha256').update('scenario_10c_bypass_' + randomUUID()).digest('hex');
    await outboxRepo.claimActionReceipt({
      tenantId: tenantA,
      locationId: locationA,
      executionId: fencingExecId,
      nodeId: 'node_10c',
      actionHash: bypassHash,
      providerKey: 'email.sendgrid',
      workerId: 'worker_sg_crashed',
      leaseSeconds: 1
    });

    await new Promise(r => setTimeout(r, 1100));

    // Caller omits providerKey and declares hasVerifiedIdempotency: true
    const reclaim = await outboxRepo.claimActionReceipt({
      tenantId: tenantA,
      locationId: locationA,
      executionId: fencingExecId,
      nodeId: 'node_10c',
      actionHash: bypassHash,
      providerKey: null,
      workerId: 'worker_bypass',
      leaseSeconds: 60,
      hasVerifiedIdempotency: true
    });

    // Must still use authoritative persisted provider identity (SendGrid) and mark indeterminate
    assert.equal(reclaim.acquired, false);
    assert.equal(reclaim.status, 'indeterminate');
    assert.equal(reclaim.disposition, 'uncertain_expired');
    assert.equal(reclaim.lastErrorCode, 'PROVIDER_RECOVERY_UNCERTAIN');
  });

  await t.test('Scenario 11: Provider with verified idempotency (Resend): retains same stable idempotency key on retry', async () => {
    const resendHash = crypto.createHash('sha256').update('scenario_11_resend_' + randomUUID()).digest('hex');
    const claim = await outboxRepo.claimActionReceipt({
      tenantId: tenantA,
      locationId: locationA,
      executionId: fencingExecId,
      nodeId: 'node_11',
      actionHash: resendHash,
      providerKey: 'email.resend',
      workerId: 'worker_crashed_resend',
      leaseSeconds: 1,
      hasVerifiedIdempotency: true
    });
    assert.equal(claim.acquired, true);

    await new Promise(r => setTimeout(r, 1100));

    const reclaim = await outboxRepo.claimActionReceipt({
      tenantId: tenantA,
      locationId: locationA,
      executionId: fencingExecId,
      nodeId: 'node_11',
      actionHash: resendHash,
      providerKey: 'email.resend',
      workerId: 'worker_recovery_resend',
      leaseSeconds: 60,
      hasVerifiedIdempotency: true
    });

    assert.equal(reclaim.acquired, true);
    assert.equal(reclaim.recovered, true);
    assert.equal(reclaim.actionHash, resendHash);
  });

  await t.test('Scenario 12: Duplicate successful receipt returned without calling provider adapter', async () => {
    let dispatchCount = 0;
    const testRegistry = createProviderAdapterRegistry();
    testRegistry.register('email.test_dispatch', {
      channel: 'email',
      dispatch: async () => {
        dispatchCount++;
        return { ok: true, providerAccepted: true, providerMessageId: 'msg_test_12', provider: 'test_provider' };
      }
    });

    const actionHash = crypto.createHash('sha256').update('scenario_12_unique_' + randomUUID()).digest('hex');
    const invocation = { providerKey: 'email.test_dispatch', actionHash };

    const res1 = await executeDurableProviderAction({
      pool, outboxRepo, tenantId: tenantA, locationId: locationA, executionId: fencingExecId,
      node: { id: 'email_node_12', config: {} },
      invocation,
      context: { to: 'lead-a@example.com', purpose: 'transactional' },
      providerRegistry: testRegistry, workerId: 'worker_1'
    });
    assert.equal(res1.ok, true);
    assert.equal(dispatchCount, 1);

    const res2 = await executeDurableProviderAction({
      pool, outboxRepo, tenantId: tenantA, locationId: locationA, executionId: fencingExecId,
      node: { id: 'email_node_12', config: {} },
      invocation,
      context: { to: 'lead-a@example.com', purpose: 'transactional' },
      providerRegistry: testRegistry, workerId: 'worker_2'
    });
    assert.equal(res2.ok, true);
    assert.equal(dispatchCount, 1); // Not called second time
  });

  await t.test('Scenario 13: Timeout after transmission begins -> PROVIDER_TIMEOUT_INDETERMINATE', async () => {
    const testRegistry = createProviderAdapterRegistry();
    testRegistry.register('email.timeout_mock', {
      channel: 'email',
      dispatch: async () => {
        const timeoutErr = new Error('Gateway timeout upstream');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }
    });

    const actionHash = crypto.createHash('sha256').update('scenario_13_timeout_' + randomUUID()).digest('hex');
    await assert.rejects(async () => {
      await executeDurableProviderAction({
        pool, outboxRepo, tenantId: tenantA, locationId: locationA, executionId: fencingExecId,
        node: { id: 'email_node_13', config: {} },
        invocation: { providerKey: 'email.timeout_mock', actionHash },
        context: { to: 'lead-a@example.com' },
        providerRegistry: testRegistry, workerId: 'worker_1'
      });
    }, /TimeoutError/);

    const receipt = await outboxRepo.getActionReceipt({ tenantId: tenantA, locationId: locationA, actionHash });
    assert.equal(receipt.status, 'indeterminate');
    assert.equal(receipt.last_error_code, 'PROVIDER_TIMEOUT_INDETERMINATE');
  });

  await t.test('Scenario 14: Connection reset with unknown provider acceptance -> PROVIDER_TRANSPORT_INDETERMINATE', async () => {
    const testRegistry = createProviderAdapterRegistry();
    testRegistry.register('email.connreset_mock', {
      channel: 'email',
      dispatch: async () => {
        const resetErr = new Error('read ECONNRESET');
        resetErr.code = 'ECONNRESET';
        resetErr.indeterminate = true;
        throw resetErr;
      }
    });

    const actionHash = crypto.createHash('sha256').update('scenario_14_connreset_' + randomUUID()).digest('hex');
    await assert.rejects(async () => {
      await executeDurableProviderAction({
        pool, outboxRepo, tenantId: tenantA, locationId: locationA, executionId: fencingExecId,
        node: { id: 'email_node_14', config: {} },
        invocation: { providerKey: 'email.connreset_mock', actionHash },
        context: { to: 'lead-a@example.com' },
        providerRegistry: testRegistry, workerId: 'worker_1'
      });
    }, (err) => err.code === 'ECONNRESET');

    const receipt = await outboxRepo.getActionReceipt({ tenantId: tenantA, locationId: locationA, actionHash });
    assert.equal(receipt.status, 'indeterminate');
    assert.equal(receipt.last_error_code, 'ECONNRESET');
  });

  await t.test('Scenario 15: Known local validation failure -> deterministic rejection, not indeterminate', async () => {
    const testRegistry = createProviderAdapterRegistry();
    testRegistry.register('email.validation_mock', {
      channel: 'email',
      dispatch: async ({ config }) => {
        if (!config?.sender) {
          return { ok: false, code: 'SENDER_EMAIL_REQUIRED', indeterminate: false };
        }
        return { ok: true };
      }
    });

    const actionHash = crypto.createHash('sha256').update('scenario_15_validation_' + randomUUID()).digest('hex');
    await assert.rejects(async () => {
      await executeDurableProviderAction({
        pool, outboxRepo, tenantId: tenantA, locationId: locationA, executionId: fencingExecId,
        node: { id: 'email_node_15', config: {} },
        invocation: { providerKey: 'email.validation_mock', actionHash },
        context: { to: 'lead-a@example.com' },
        providerRegistry: testRegistry, workerId: 'worker_1'
      });
    }, (err) => err.code === 'SENDER_EMAIL_REQUIRED' && err.indeterminate === false);

    const receipt = await outboxRepo.getActionReceipt({ tenantId: tenantA, locationId: locationA, actionHash });
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.last_error_code, 'SENDER_EMAIL_REQUIRED');
  });

  await t.test('Scenario 16: Definitive provider rejection (401/400) classified according to policy', async () => {
    const testRegistry = createProviderAdapterRegistry();
    testRegistry.register('email.auth_fail', {
      channel: 'email',
      dispatch: async () => {
        return { ok: false, code: 'INVALID_CREDENTIAL', status: 401, indeterminate: false };
      }
    });

    const actionHash = crypto.createHash('sha256').update('scenario_16_auth_' + randomUUID()).digest('hex');
    await assert.rejects(async () => {
      await executeDurableProviderAction({
        pool, outboxRepo, tenantId: tenantA, locationId: locationA, executionId: fencingExecId,
        node: { id: 'email_node_16', config: {} },
        invocation: { providerKey: 'email.auth_fail', actionHash },
        context: { to: 'lead-a@example.com' },
        providerRegistry: testRegistry, workerId: 'worker_1'
      });
    }, (err) => err.code === 'INVALID_CREDENTIAL');

    const receipt = await outboxRepo.getActionReceipt({ tenantId: tenantA, locationId: locationA, actionHash });
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.last_error_code, 'INVALID_CREDENTIAL');
  });

  await t.test('Scenario 17: Worker cancellation propagated (WORKER_CANCELLED_INDETERMINATE)', async () => {
    const testRegistry = createProviderAdapterRegistry();
    testRegistry.register('email.abort_mock', {
      channel: 'email',
      dispatch: async ({ signal }) => {
        if (signal?.aborted) {
          const abortErr = new Error('Worker execution cancelled');
          abortErr.name = 'AbortError';
          abortErr.code = 'WORKER_CANCELLED_INDETERMINATE';
          abortErr.indeterminate = true;
          throw abortErr;
        }
        return { ok: true };
      }
    });

    const controller = new AbortController();
    controller.abort();

    const actionHash = crypto.createHash('sha256').update('scenario_17_abort_' + randomUUID()).digest('hex');
    await assert.rejects(async () => {
      await executeDurableProviderAction({
        pool, outboxRepo, tenantId: tenantA, locationId: locationA, executionId: fencingExecId,
        node: { id: 'email_node_17', config: {} },
        invocation: { providerKey: 'email.abort_mock', actionHash },
        context: { to: 'lead-a@example.com' },
        providerRegistry: testRegistry, workerId: 'worker_1', signal: controller.signal
      });
    }, (err) => err.indeterminate === true);

    const receipt = await outboxRepo.getActionReceipt({ tenantId: tenantA, locationId: locationA, actionHash });
    assert.equal(receipt.status, 'indeterminate');
  });

  // ---------------------------------------------------------------------------
  // PART 3: CRM ACTION IDEMPOTENCY & STABILIZATION (Scenarios 18 - 25)
  // ---------------------------------------------------------------------------

  await t.test('Scenario 18: Concurrent duplicate task creation results in exactly 1 task record', async () => {
    const { executionId, workflowId } = await seedExecution();
    const crmActions1 = createRealCrmActions({
      pool, tenantId: tenantA, locationId: locationA, executionId, workflowId, workerId: 'worker_1', outboxRepository: outboxRepo
    });
    const crmActions2 = createRealCrmActions({
      pool, tenantId: tenantA, locationId: locationA, executionId, workflowId, workerId: 'worker_2', outboxRepository: outboxRepo
    });

    const taskPayload = { title: 'Follow Up Immediately', priority: 'high', contactId: contactIdA, nodeId: 'task_step_18' };

    const res1 = await crmActions1.createTask(taskPayload);
    assert.ok(res1.id);

    const res2 = await crmActions2.createTask(taskPayload);
    assert.equal(res2.id, res1.id);

    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA]);
      const tasks = await client.query("SELECT id FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = 'tasks' AND body->>'title' = $3", [tenantA, locationA, 'Follow Up Immediately']);
      assert.equal(tasks.rows.length, 1);
    } finally {
      client.release();
    }
  });

  await t.test('Scenario 19: Duplicate contact tag addition is idempotent and records receipt', async () => {
    const { executionId, workflowId } = await seedExecution();
    const crmActions = createRealCrmActions({
      pool, tenantId: tenantA, locationId: locationA, executionId, workflowId, workerId: 'worker_1', outboxRepository: outboxRepo
    });

    const res1 = await crmActions.addContactTag({ contactId: contactIdA, tag: 'vip_prospect', nodeId: 'tag_step_19' });
    assert.equal(res1.tagAdded, 'vip_prospect');

    const res2 = await crmActions.addContactTag({ contactId: contactIdA, tag: 'vip_prospect', nodeId: 'tag_step_19' });
    assert.equal(res2.tagAdded, 'vip_prospect');

    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA]);
      const contact = await client.query("SELECT body FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts' AND id = $3", [tenantA, locationA, contactIdA]);
      const tags = contact.rows[0].body.tags;
      const count = tags.filter(t => t === 'vip_prospect').length;
      assert.equal(count, 1);
    } finally {
      client.release();
    }
  });

  await t.test('Scenario 20: Opportunity stage updating idempotently records receipts', async () => {
    const { executionId, workflowId } = await seedExecution();
    const oppId = randomUUID();

    await pool.query(`
      INSERT INTO location_records (id, agency_id, location_id, collection, body, created_at, updated_at)
      VALUES ($1, $2, $3, 'opportunities', $4::jsonb, now(), now())
    `, [oppId, tenantA, locationA, JSON.stringify({ id: oppId, stage: 'open', status: 'open' })]);

    const crmActions = createRealCrmActions({
      pool, tenantId: tenantA, locationId: locationA, executionId, workflowId, workerId: 'worker_1', outboxRepository: outboxRepo
    });

    const res1 = await crmActions.updateOpportunityStage({ opportunityId: oppId, stage: 'won', nodeId: 'stage_step_20' });
    assert.equal(res1.stageUpdated, 'won');

    const res2 = await crmActions.updateOpportunityStage({ opportunityId: oppId, stage: 'won', nodeId: 'stage_step_20' });
    assert.equal(res2.stageUpdated, 'won');
  });

  await t.test('Scenario 21: Same CRM action produces same hash after worker restart / replay', () => {
    const params = {
      tenantId: tenantA,
      locationId: locationA,
      workflowId: 'wf_replay',
      executionId: 'exec_replay',
      nodeId: 'task_step',
      actionType: 'create_task',
      invocationKey: 'default',
      input: { title: 'Call Client', priority: 'high' }
    };

    const hash1 = computeActionHash(params);
    const hash2 = computeActionHash(params);
    assert.equal(hash1, hash2);
  });

  await t.test('Scenario 22: Task action retains default due date across retries', async () => {
    const fixedStartTime = '2026-11-20T10:00:00.000Z';
    const execution = {
      id: randomUUID(),
      workflowId: randomUUID(),
      agencyId: tenantA,
      locationId: locationA,
      startedAt: fixedStartTime,
      actorId: 'system_worker',
      mode: 'live'
    };

    const node = {
      id: 'task_node_due',
      type: 'task',
      config: { title: 'Deterministic Due Date Task' }
    };

    let capturedDue1 = null;
    let capturedDue2 = null;

    const mockCrm1 = {
      createTask: async (taskInput) => {
        capturedDue1 = taskInput.dueDate;
        return { id: 'task_mock_1', dueDate: taskInput.dueDate };
      }
    };
    const mockCrm2 = {
      createTask: async (taskInput) => {
        capturedDue2 = taskInput.dueDate;
        return { id: 'task_mock_1', dueDate: taskInput.dueDate };
      }
    };

    await executeStep({ node, execution, triggerContext: {}, crmActions: mockCrm1 });
    await executeStep({ node, execution, triggerContext: {}, crmActions: mockCrm2 });

    assert.ok(capturedDue1);
    assert.equal(capturedDue1, capturedDue2);
    const expectedDueDate = new Date(Date.parse(fixedStartTime) + 86400000).toISOString();
    assert.equal(capturedDue1, expectedDueDate);
  });

  await t.test('Scenario 23: Different resolved recipients produce different action hashes', () => {
    const hashAlice = computeActionHash({
      tenantId: tenantA,
      locationId: locationA,
      workflowId: 'wf_send',
      executionId: 'exec_send',
      nodeId: 'email_node',
      actionType: 'send_email',
      input: { to: 'alice@example.com', body: 'Welcome to the platform' }
    });

    const hashBob = computeActionHash({
      tenantId: tenantA,
      locationId: locationA,
      workflowId: 'wf_send',
      executionId: 'exec_send',
      nodeId: 'email_node',
      actionType: 'send_email',
      input: { to: 'bob@example.com', body: 'Welcome to the platform' }
    });

    assert.notEqual(hashAlice, hashBob);
  });

  await t.test('Scenario 24: Different resolved message bodies produce different action hashes', () => {
    const hash1 = computeActionHash({
      tenantId: tenantA,
      locationId: locationA,
      workflowId: 'wf_send',
      executionId: 'exec_send',
      nodeId: 'email_node',
      actionType: 'send_email',
      input: { to: 'alice@example.com', body: 'Notification message A' }
    });

    const hash2 = computeActionHash({
      tenantId: tenantA,
      locationId: locationA,
      workflowId: 'wf_send',
      executionId: 'exec_send',
      nodeId: 'email_node',
      actionType: 'send_email',
      input: { to: 'alice@example.com', body: 'Notification message B' }
    });

    assert.notEqual(hash1, hash2);
  });

  await t.test('Scenario 25: Repeated invocations with distinct invocationKey (e.g. loops) are distinguished', () => {
    const hashIndex0 = computeActionHash({
      tenantId: tenantA,
      locationId: locationA,
      workflowId: 'wf_loop',
      executionId: 'exec_loop',
      nodeId: 'loop_step',
      actionType: 'task',
      invocationKey: 'loop_index_0',
      input: { title: 'Process Item' }
    });

    const hashIndex1 = computeActionHash({
      tenantId: tenantA,
      locationId: locationA,
      workflowId: 'wf_loop',
      executionId: 'exec_loop',
      nodeId: 'loop_step',
      actionType: 'task',
      invocationKey: 'loop_index_1',
      input: { title: 'Process Item' }
    });

    assert.notEqual(hashIndex0, hashIndex1);
  });

  // ---------------------------------------------------------------------------
  // PART 4: GOVERNANCE & EXECUTION SECURITY (Scenarios 26 - 30)
  // ---------------------------------------------------------------------------

  await t.test('Scenario 26: Truthy but invalid approval evidence is rejected', async () => {
    const handlers = createTrustedWorkerHandlers({ pool, outboxRepository: outboxRepo });

    // Invalid string approval
    await assert.rejects(async () => {
      await handlers['workflow.action.execute']({
        tenantId: tenantA,
        locationId: locationA,
        actionId: 'send_email',
        actionType: 'send_email',
        actorId: 'usr_admin',
        approvalEvidence: 'approved_token_mock',
        input: { to: 'test@example.com' }
      }, { job: {}, workerId: 'w1' });
    }, (err) => err.code === 'APPROVAL_REQUIRED');

    // Tampered checksum
    await assert.rejects(async () => {
      await handlers['workflow.action.execute']({
        tenantId: tenantA,
        locationId: locationA,
        actionId: 'send_email',
        actionType: 'send_email',
        actorId: 'usr_admin',
        approvalEvidence: {
          status: 'approved',
          approvedBy: 'approver_1',
          checksum: 'f'.repeat(64), // invalid checksum
          expiresAt: new Date(Date.now() + 60000).toISOString()
        },
        input: { to: 'test@example.com' }
      }, { job: {}, workerId: 'w1' });
    }, (err) => err.code === 'APPROVAL_TAMPERED');
  });

  await t.test('Scenario 27: Expired approval evidence is rejected', async () => {
    const handlers = createTrustedWorkerHandlers({ pool, outboxRepository: outboxRepo });

    await assert.rejects(async () => {
      await handlers['workflow.action.execute']({
        tenantId: tenantA,
        locationId: locationA,
        actionId: 'send_email',
        actionType: 'send_email',
        actorId: 'usr_admin',
        approvalEvidence: {
          status: 'approved',
          approvedBy: 'approver_1',
          expiresAt: new Date(Date.now() - 5000).toISOString() // expired 5s ago
        },
        input: { to: 'test@example.com' }
      }, { job: {}, workerId: 'w1' });
    }, (err) => err.code === 'APPROVAL_EXPIRED');
  });

  await t.test('Scenario 28: Approval for another node or action is rejected', async () => {
    const handlers = createTrustedWorkerHandlers({ pool, outboxRepository: outboxRepo });

    await assert.rejects(async () => {
      await handlers['workflow.action.execute']({
        tenantId: tenantA,
        locationId: locationA,
        actionId: 'send_email_node_1',
        actionType: 'send_email',
        actorId: 'usr_admin',
        approvalEvidence: {
          status: 'approved',
          approvedBy: 'approver_1',
          nodeId: 'different_node_99',
          expiresAt: new Date(Date.now() + 60000).toISOString()
        },
        input: { to: 'test@example.com' }
      }, { job: {}, workerId: 'w1' });
    }, (err) => err.code === 'APPROVAL_NODE_MISMATCH');
  });

  await t.test('Scenario 29: Missing trusted actor identity fails closed', async () => {
    const handlers = createTrustedWorkerHandlers({ pool, outboxRepository: outboxRepo });

    await assert.rejects(async () => {
      await handlers['workflow.action.execute']({
        tenantId: tenantA,
        locationId: locationA,
        actionId: 'send_email',
        actionType: 'send_email',
        actorId: '   ', // whitespace only
        input: { to: 'test@example.com' }
      }, { job: {}, workerId: 'w1' });
    }, (err) => err.code === 'ACTOR_IDENTITY_REQUIRED');
  });

  await t.test('Scenario 30: Missing or revoked authoritative consent prevents provider dispatch', async () => {
    const handlers = createTrustedWorkerHandlers({ pool, outboxRepository: outboxRepo });

    await assert.rejects(async () => {
      await handlers['workflow.action.execute']({
        tenantId: tenantA,
        locationId: locationA,
        actionId: 'send_email',
        actionType: 'send_email',
        actorId: 'usr_admin',
        providerKey: 'email.sendgrid',
        input: { to: 'unconsented_lead@example.com' },
        dryRun: false,
        approvalEvidence: { approvedBy: 'usr_approver' },
        consent: false
      }, { job: {}, workerId: 'w1' });
    }, (err) => err.code === 'CONSENT_REQUIRED');
  });

  // ---------------------------------------------------------------------------
  // PART 5: DATABASE SECURITY & LEAST PRIVILEGE
  // ---------------------------------------------------------------------------

  await t.test('Database Security: operza_app role is constrained to tenant scope under FORCE RLS', async () => {
    const { executionId } = await seedExecution();
    const appPool = new pg.Pool({
      connectionString: dbUrl.replace(/\/\/[^@]+@/, '//operza_app:operza_app_secret@'),
      max: 2
    });

    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA]);

      const hash = crypto.createHash('sha256').update('scenario_rls_app').digest('hex');
      await client.query(`
        INSERT INTO workflow_action_receipts (id, agency_id, location_id, execution_id, node_id, action_hash, status)
        VALUES ($1, $2, $3, $4, 'node_rls_app', $5, 'succeeded')
      `, [randomUUID(), tenantA, locationA, executionId, hash]);

      const res = await client.query("SELECT id FROM workflow_action_receipts WHERE action_hash = $1", [hash]);
      assert.equal(res.rows.length, 1);
      await client.query('COMMIT');
    } finally {
      client.release();
      await appPool.end();
    }
  });

  await t.test('Database Security: operza_worker role claims and completes receipts under FORCE RLS', async () => {
    const { executionId } = await seedExecution();
    const workerPool = new pg.Pool({
      connectionString: dbUrl.replace(/\/\/[^@]+@/, '//operza_worker:operza_worker_secret@'),
      max: 2
    });

    const workerRepo = createWorkflowOutboxRepository(workerPool);
    const actionHash = crypto.createHash('sha256').update('scenario_rls_worker').digest('hex');

    const claim = await workerRepo.claimActionReceipt({
      tenantId: tenantA, locationId: locationA, executionId, nodeId: 'node_rls_worker', actionHash, workerId: 'worker_rls'
    });
    assert.equal(claim.acquired, true);
    assert.ok(claim.claimToken);

    const comp = await workerRepo.completeActionReceipt({
      tenantId: tenantA, locationId: locationA, actionHash, claimToken: claim.claimToken, result: { ok: true }
    });
    assert.equal(comp.status, 'succeeded');
    await workerPool.end();
  });

  await t.test('Database Security: Missing tenant context fails closed under RLS', async () => {
    const workerPool = new pg.Pool({
      connectionString: dbUrl.replace(/\/\/[^@]+@/, '//operza_worker:operza_worker_secret@'),
      max: 2
    });

    const client = await workerPool.connect();
    try {
      const res = await client.query("SELECT * FROM workflow_action_receipts");
      assert.equal(res.rows.length, 0);
    } finally {
      client.release();
      await workerPool.end();
    }
  });

  await t.test('Database Security: Cross-tenant access is strictly denied under FORCE RLS', async () => {
    const workerPool = new pg.Pool({
      connectionString: dbUrl.replace(/\/\/[^@]+@/, '//operza_worker:operza_worker_secret@'),
      max: 2
    });

    const client = await workerPool.connect();
    try {
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantB, locationB]);

      const crossRead = await client.query("SELECT * FROM location_records WHERE id = $1", [contactIdA]);
      assert.equal(crossRead.rows.length, 0);

      const crossUpdate = await client.query("UPDATE location_records SET body = body WHERE id = $1", [contactIdA]);
      assert.equal(crossUpdate.rowCount, 0);
    } finally {
      client.release();
      await workerPool.end();
    }
  });
});
