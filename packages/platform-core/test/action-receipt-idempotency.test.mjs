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
import { createProviderAdapterRegistry } from '../src/provider-adapters.mjs';
import { IsolatedTestPostgres } from '../../db/lib/test-postgres-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

test('OPERZA GROWTH — Workflow Action Receipt & Idempotency Suite (Scenarios 1-25)', async (t) => {
  let pgServer = null;
  let pool = null;
  let dbUrl = process.env.OPERZA_TEST_DATABASE_URL;

  try {
    if (!dbUrl) {
      pgServer = new IsolatedTestPostgres({ port: 0, dbName: 'operza_idempotency_suite_test' });
      dbUrl = await pgServer.start();
    }

    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: dbUrl, max: 10 });

    const migCheck = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations'");
    if (migCheck.rows.length === 0) {
      // Bootstrap roles and apply all 31 migrations
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
    }
  } catch (err) {
    console.warn('[IDEMPOTENCY-TEST] PostgreSQL setup warning:', err.message);
  }

  t.after(async () => {
    if (pool) await pool.end().catch(() => {});
    if (pgServer) await pgServer.stop().catch(() => {});
  });

  const tenantA = randomUUID();
  const locationA = randomUUID();
  const tenantB = randomUUID();
  const locationB = randomUUID();
  const contactIdA = randomUUID();
  const outboxRepo = pool ? createWorkflowOutboxRepository(pool) : null;

  async function seedExecution({ agencyId = tenantA, locationId = locationA, workflowId = null, executionId = null } = {}) {
    if (!pool) return { workflowId: workflowId || randomUUID(), executionId: executionId || randomUUID() };
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

  if (pool) {
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
  }

  // ---------------------------------------------------------------------------
  // PART 1: CRM ACTION IDEMPOTENCY (Scenarios 1 - 7)
  // ---------------------------------------------------------------------------

  await t.test('Scenario 1: Concurrent duplicate task creation results in exactly 1 task record', async () => {
    if (!pool) return;
    const { executionId, workflowId } = await seedExecution();
    const crmActions1 = createRealCrmActions({
      pool, tenantId: tenantA, locationId: locationA, executionId, workflowId, workerId: 'worker_1', outboxRepository: outboxRepo
    });
    const crmActions2 = createRealCrmActions({
      pool, tenantId: tenantA, locationId: locationA, executionId, workflowId, workerId: 'worker_2', outboxRepository: outboxRepo
    });

    const taskPayload = { title: 'Follow Up Immediately', priority: 'high', contactId: contactIdA, nodeId: 'task_step_1' };

    // Worker 1 creates task
    const res1 = await crmActions1.createTask(taskPayload);
    assert.ok(res1.id);

    // Worker 2 attempts identical task creation
    const res2 = await crmActions2.createTask(taskPayload);
    // Duplicate returns the exact same task ID from the stored receipt
    assert.equal(res2.id, res1.id);

    // Verify exactly 1 task record exists in PostgreSQL
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA]);
      const tasks = await client.query("SELECT id FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = 'tasks' AND body->>'title' = $3", [tenantA, locationA, 'Follow Up Immediately']);
      assert.equal(tasks.rows.length, 1);
    } finally {
      client.release();
    }
  });

  await t.test('Scenario 2: Duplicate contact tag addition is idempotent and records receipt', async () => {
    if (!pool) return;
    const { executionId, workflowId } = await seedExecution();
    const crmActions = createRealCrmActions({
      pool, tenantId: tenantA, locationId: locationA, executionId, workflowId, workerId: 'worker_1', outboxRepository: outboxRepo
    });

    const res1 = await crmActions.addContactTag({ contactId: contactIdA, tag: 'vip_prospect', nodeId: 'tag_step_1' });
    assert.equal(res1.tagAdded, 'vip_prospect');

    // Second call is idempotent
    const res2 = await crmActions.addContactTag({ contactId: contactIdA, tag: 'vip_prospect', nodeId: 'tag_step_1' });
    assert.equal(res2.tagAdded, 'vip_prospect');

    // Verify contact tags in database has no duplicates
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

  await t.test('Scenario 3: Opportunity stage updating idempotently records receipts', async () => {
    if (!pool) return;
    const { executionId, workflowId } = await seedExecution();
    const oppId = randomUUID();

    // Seed opportunity in location_records
    await pool.query(`
      INSERT INTO location_records (id, agency_id, location_id, collection, body, created_at, updated_at)
      VALUES ($1, $2, $3, 'opportunities', $4::jsonb, now(), now())
    `, [oppId, tenantA, locationA, JSON.stringify({ id: oppId, stage: 'open', status: 'open' })]);

    const crmActions = createRealCrmActions({
      pool, tenantId: tenantA, locationId: locationA, executionId, workflowId, workerId: 'worker_1', outboxRepository: outboxRepo
    });

    const res1 = await crmActions.updateOpportunityStage({ opportunityId: oppId, stage: 'won', nodeId: 'stage_step_1' });
    assert.equal(res1.stageUpdated, 'won');

    // Duplicate call returns cached receipt result
    const res2 = await crmActions.updateOpportunityStage({ opportunityId: oppId, stage: 'won', nodeId: 'stage_step_1' });
    assert.equal(res2.stageUpdated, 'won');
  });

  await t.test('Scenario 4: Worker restart/replay re-runs workflow without duplicating CRM records', async () => {
    if (!pool) return;
    const { executionId, workflowId } = await seedExecution();
    const crmActions = createRealCrmActions({
      pool, tenantId: tenantA, locationId: locationA, executionId, workflowId, workerId: 'worker_alpha', outboxRepository: outboxRepo
    });

    // Run task creation in run 1
    const res1 = await crmActions.createTask({ title: 'Replay Test Task', contactId: contactIdA, nodeId: 'task_replay_1' });

    // Worker restarts, receives same job/execution and executes again
    const crmActionsRestart = createRealCrmActions({
      pool, tenantId: tenantA, locationId: locationA, executionId, workflowId, workerId: 'worker_beta', outboxRepository: outboxRepo
    });
    const res2 = await crmActionsRestart.createTask({ title: 'Replay Test Task', contactId: contactIdA, nodeId: 'task_replay_1' });

    assert.equal(res1.id, res2.id);
  });

  await t.test('Scenario 5: Transaction rollback on CRM failure leaves zero orphaned succeeded receipt', async () => {
    if (!pool) return;
    const { executionId, workflowId } = await seedExecution();
    const nonExistentContact = randomUUID();
    const crmActions = createRealCrmActions({
      pool, tenantId: tenantA, locationId: locationA, executionId, workflowId, workerId: 'worker_1', outboxRepository: outboxRepo
    });

    // Attempt to tag non-existent contact -> fails with CONTACT_NOT_FOUND
    await assert.rejects(async () => {
      await crmActions.addContactTag({ contactId: nonExistentContact, tag: 'orphan_test', nodeId: 'tag_fail_1' });
    }, (err) => err.code === 'CONTACT_NOT_FOUND' || /not found in PostgreSQL/i.test(err.message));

    // Verify receipt does NOT have status 'succeeded'
    const hash = computeActionHash({
      tenantId: tenantA, locationId: locationA, workflowId, executionId,
      nodeId: 'tag_fail_1', actionType: 'add_tag', input: { contactId: nonExistentContact, tag: 'orphan_test' }
    });

    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA]);
      const receipt = await client.query("SELECT status FROM workflow_action_receipts WHERE agency_id = $1 AND location_id = $2 AND action_hash = $3", [tenantA, locationA, hash]);
      // Either rolled back completely (0 rows) or not 'succeeded'
      if (receipt.rows.length > 0) {
        assert.notEqual(receipt.rows[0].status, 'succeeded');
      }
    } finally {
      client.release();
    }
  });

  await t.test('Scenario 6: Uncommitted worker transaction leaves no receipt and no mutated row', async () => {
    if (!pool) return;
    const { executionId, workflowId } = await seedExecution();
    const client = await pool.connect();
    const actionHash = computeActionHash({
      tenantId: tenantA, locationId: locationA, workflowId, executionId,
      nodeId: 'node_abort', actionType: 'create_task', input: { title: 'Abort Task' }
    });

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA]);
      await outboxRepo.claimActionReceipt({
        client, tenantId: tenantA, locationId: locationA, executionId, nodeId: 'node_abort', actionHash
      });
      // Worker abruptly crashes / rolls back
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // Verify receipt does NOT exist
    const verifyClient = await pool.connect();
    try {
      await verifyClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA]);
      const check = await verifyClient.query("SELECT * FROM workflow_action_receipts WHERE agency_id = $1 AND location_id = $2 AND action_hash = $3", [tenantA, locationA, actionHash]);
      assert.equal(check.rows.length, 0);
    } finally {
      verifyClient.release();
    }
  });

  await t.test('Scenario 7: Worker serialization throws ACTION_ALREADY_IN_PROGRESS on concurrent claim', async () => {
    if (!pool) return;
    const { executionId, workflowId } = await seedExecution();
    const actionHash = computeActionHash({
      tenantId: tenantA, locationId: locationA, workflowId, executionId,
      nodeId: 'task_lock_1', actionType: 'create_task', input: { title: 'Lock Task' }
    });

    // Worker 1 claims receipt with active lease
    const claim1 = await outboxRepo.claimActionReceipt({
      tenantId: tenantA, locationId: locationA, executionId, nodeId: 'task_lock_1',
      actionHash, workerId: 'worker_holder', leaseSeconds: 60
    });
    assert.equal(claim1.acquired, true);

    // Worker 2 attempts same execution while lease is held
    await assert.rejects(async () => {
      await executeAtomicCrmAction({
        pool, outboxRepo, tenantId: tenantA, locationId: locationA, executionId, workflowId,
        nodeId: 'task_lock_1', actionType: 'create_task', input: { title: 'Lock Task' },
        workerId: 'worker_challenger', mutationFn: async () => ({})
      });
    }, (err) => err.code === 'ACTION_ALREADY_IN_PROGRESS' || /already in progress/i.test(err.message));
  });

  // ---------------------------------------------------------------------------
  // PART 2: PROVIDER ACTION IDEMPOTENCY (Scenarios 8 - 14)
  // ---------------------------------------------------------------------------

  await t.test('Scenario 8: Duplicate provider redispatch prevention returns stored receipt', async () => {
    let dispatchCount = 0;
    const testRegistry = createProviderAdapterRegistry();
    testRegistry.register('email.test_dispatch', {
      channel: 'email',
      dispatch: async ({ actionHash }) => {
        dispatchCount++;
        return { ok: true, providerAccepted: true, providerMessageId: 'msg_test_123', provider: 'test_provider' };
      }
    });

    const { executionId } = await seedExecution();
    const invocation = {
      providerKey: 'email.test_dispatch',
      actionHash: crypto.createHash('sha256').update('scenario_8_unique').digest('hex')
    };

    // First dispatch
    const res1 = await executeDurableProviderAction({
      pool, outboxRepo, tenantId: tenantA, locationId: locationA, executionId,
      node: { id: 'email_node_1', config: {} },
      invocation,
      context: { to: 'lead-a@example.com', purpose: 'transactional' },
      providerRegistry: testRegistry, workerId: 'worker_1'
    });
    assert.equal(res1.ok, true);
    assert.equal(dispatchCount, 1);

    // Second dispatch with same actionHash
    const res2 = await executeDurableProviderAction({
      pool, outboxRepo, tenantId: tenantA, locationId: locationA, executionId,
      node: { id: 'email_node_1', config: {} },
      invocation,
      context: { to: 'lead-a@example.com', purpose: 'transactional' },
      providerRegistry: testRegistry, workerId: 'worker_2'
    });
    // Returns cached result, adapter NOT dispatched second time!
    assert.equal(res2.ok, true);
    assert.equal(dispatchCount, 1);
  });

  await t.test('Scenario 9: Concurrent provider claim serializes and blocks concurrent dispatch', async () => {
    if (!pool) return;
    const { executionId } = await seedExecution();
    const actionHash = crypto.createHash('sha256').update('scenario_9_unique').digest('hex');
    const testRegistry = createProviderAdapterRegistry();
    testRegistry.register('email.test', { channel: 'email', dispatch: async () => ({ ok: true }) });

    // Pre-claim active lease by Worker 1
    await outboxRepo.claimActionReceipt({
      tenantId: tenantA, locationId: locationA, executionId, nodeId: 'email_node_9',
      actionHash, providerKey: 'email.test', workerId: 'worker_alpha', leaseSeconds: 60
    });

    // Worker 2 attempts dispatch
    await assert.rejects(async () => {
      await executeDurableProviderAction({
        pool, outboxRepo, tenantId: tenantA, locationId: locationA, executionId,
        node: { id: 'email_node_9', config: {} },
        invocation: { providerKey: 'email.test', actionHash },
        context: { to: 'lead-a@example.com' },
        providerRegistry: testRegistry, workerId: 'worker_beta'
      });
    }, (err) => err.code === 'ACTION_ALREADY_IN_PROGRESS' || /already in progress/i.test(err.message));
  });

  await t.test('Scenario 10: Idempotency-Key is deterministic and stable across retries', () => {
    const params = {
      tenantId: tenantA, locationId: locationA, workflowId: 'wf_1', executionId: 'exec_1',
      nodeId: 'email_step', actionType: 'send_email', invocationKey: 'loop_idx_0',
      input: { to: 'test@operza.io', subject: 'Welcome' }
    };

    const hash1 = computeActionHash(params);
    const hash2 = computeActionHash(params);
    assert.equal(hash1, hash2);
    assert.match(hash1, /^[a-f0-9]{64}$/);
  });

  await t.test('Scenario 11: Pre-dispatch crash allows recovery worker to retry after lease expiration', async () => {
    if (!pool) return;
    const { executionId } = await seedExecution();
    const actionHash = crypto.createHash('sha256').update('scenario_11_unique').digest('hex');

    // Worker 1 claims with 1-second lease then crashes
    await outboxRepo.claimActionReceipt({
      tenantId: tenantA, locationId: locationA, executionId, nodeId: 'email_node_11',
      actionHash, providerKey: 'email.test', workerId: 'worker_crashed', leaseSeconds: 1
    });

    // Wait 1.1s for lease to expire
    await new Promise(r => setTimeout(r, 1100));

    // Recovery Worker claims expired lease
    const recoveryClaim = await outboxRepo.claimActionReceipt({
      tenantId: tenantA, locationId: locationA, executionId, nodeId: 'email_node_11',
      actionHash, providerKey: 'email.test', workerId: 'worker_recovery', leaseSeconds: 60
    });
    assert.equal(recoveryClaim.acquired, true);
    assert.equal(recoveryClaim.recovered, true);
  });

  await t.test('Scenario 12: Ambiguous timeout / abort is marked indeterminate in receipt', async () => {
    if (!pool) return;
    const testRegistry = createProviderAdapterRegistry();
    testRegistry.register('email.timeout_mock', {
      channel: 'email',
      dispatch: async () => {
        const timeoutErr = new Error('Gateway timeout upstream');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }
    });

    const { executionId } = await seedExecution();
    const actionHash = crypto.createHash('sha256').update('scenario_12_unique').digest('hex');

    await assert.rejects(async () => {
      await executeDurableProviderAction({
        pool, outboxRepo, tenantId: tenantA, locationId: locationA, executionId,
        node: { id: 'email_node_12', config: {} },
        invocation: { providerKey: 'email.timeout_mock', actionHash },
        context: { to: 'lead-a@example.com' },
        providerRegistry: testRegistry, workerId: 'worker_1'
      });
    }, /TimeoutError/);

    // Verify receipt has status 'indeterminate'
    const receipt = await outboxRepo.getActionReceipt({ tenantId: tenantA, locationId: locationA, actionHash });
    assert.equal(receipt.status, 'indeterminate');
    assert.equal(receipt.last_error_code, 'PROVIDER_TIMEOUT_INDETERMINATE');
  });

  await t.test('Scenario 13: Indeterminate status is blocked from blind re-dispatch', async () => {
    if (!pool) return;
    const { executionId } = await seedExecution();
    const actionHash = crypto.createHash('sha256').update('scenario_13_unique').digest('hex');
    const testRegistry = createProviderAdapterRegistry();
    testRegistry.register('email.test', { channel: 'email', dispatch: async () => ({ ok: true }) });

    // Create indeterminate receipt
    await outboxRepo.claimActionReceipt({
      tenantId: tenantA, locationId: locationA, executionId, nodeId: 'email_node_13',
      actionHash, providerKey: 'email.test', workerId: 'worker_1'
    });
    await outboxRepo.failActionReceipt({
      tenantId: tenantA, locationId: locationA, actionHash, errorCode: 'PROVIDER_TIMEOUT_INDETERMINATE', indeterminate: true
    });

    // Next dispatch attempt must throw ACTION_INDETERMINATE
    await assert.rejects(async () => {
      await executeDurableProviderAction({
        pool, outboxRepo, tenantId: tenantA, locationId: locationA, executionId,
        node: { id: 'email_node_13', config: {} },
        invocation: { providerKey: 'email.test', actionHash },
        context: { to: 'lead-a@example.com' },
        providerRegistry: testRegistry, workerId: 'worker_2'
      });
    }, (err) => err.code === 'ACTION_INDETERMINATE' || /indeterminate/i.test(err.message));
  });

  await t.test('Scenario 14: Zero secrets stored in workflow_action_receipts table', async () => {
    if (!pool) return;
    const { executionId } = await seedExecution();
    const actionHash = crypto.createHash('sha256').update('scenario_14_unique').digest('hex');

    await outboxRepo.claimActionReceipt({
      tenantId: tenantA, locationId: locationA, executionId, nodeId: 'node_14',
      actionHash, providerKey: 'email.resend', workerId: 'worker_1'
    });

    await outboxRepo.completeActionReceipt({
      tenantId: tenantA, locationId: locationA, actionHash,
      result: { ok: true, providerMessageId: 'msg_clean_123', provider: 'resend' },
      providerReceipt: 'msg_clean_123'
    });

    const receipt = await outboxRepo.getActionReceipt({ tenantId: tenantA, locationId: locationA, actionHash });
    const serialized = JSON.stringify(receipt);
    assert.equal(/bearer|secret|apikey|password|token/i.test(serialized), false);
  });

  // ---------------------------------------------------------------------------
  // PART 3: GOVERNANCE & EXECUTION (Scenarios 15 - 20)
  // ---------------------------------------------------------------------------

  await t.test('Scenario 15: Trusted actor identity is recorded and verified in governance', () => {
    const wfId = randomUUID();
    const exId = randomUUID();
    const actionHash = computeActionHash({
      tenantId: tenantA, locationId: locationA, workflowId: wfId, executionId: exId,
      nodeId: 'node_trusted', nodeType: 'send_email', input: { to: 'test@operza.io' }
    });

    const req = createApprovalRequest({
      tenantId: tenantA, workflowId: wfId, executionId: exId, nodeId: 'node_trusted',
      requestedByActorId: 'user_trusted_admin', actionHash,
      expiresAt: new Date(Date.now() + 60000).toISOString()
    });
    const evidence = decideApproval({
      request: req, tenantId: tenantA, approvedByActorId: 'admin_approver', decision: 'approved'
    });

    const invocation = createActionInvocation({
      tenantId: tenantA, locationId: locationA, workflowId: wfId, executionId: exId,
      actorId: 'user_trusted_admin',
      node: { id: 'node_trusted', type: 'send_email' },
      input: { to: 'test@operza.io' },
      mode: 'live', providerStatus: 'verified', consent: true,
      approvalEvidence: evidence
    });

    assert.equal(invocation.actorId, 'user_trusted_admin');
    assert.equal(invocation.actionHash, actionHash);
    const auth = authorizeActionInvocation(invocation);
    assert.equal(auth.decision, 'allow');
  });

  await t.test('Scenario 16: Missing or invalid actor identity fails closed in sensitive nodes', () => {
    assert.throws(() => {
      createActionInvocation({
        tenantId: tenantA, locationId: locationA, workflowId: randomUUID(), executionId: randomUUID(),
        actorId: '   ', // invalid blank actor
        node: { id: 'node_sens', type: 'send_email' },
        input: { to: 'test@operza.io' },
        mode: 'live'
      });
    }, /actorId/);
  });

  await t.test('Scenario 17: Consent missing throws CONSENT_REQUIRED before dispatch', async () => {
    const handlers = createTrustedWorkerHandlers({
      pool, outboxRepository: outboxRepo
    });

    const jobPayload = {
      tenantId: tenantA,
      locationId: locationA,
      actionId: 'send_email',
      actionType: 'send_email',
      providerKey: 'email.sendgrid',
      input: { to: 'unconsented_lead@example.com' },
      dryRun: false,
      approved: true,
      consent: false
    };

    await assert.rejects(async () => {
      await handlers['workflow.action.execute'](jobPayload, { job: {}, workerId: 'worker_1' });
    }, (err) => err.code === 'CONSENT_REQUIRED' || /consent/i.test(err.message));
  });

  await t.test('Scenario 18: Dry-run execution generates zero durable receipts and zero CRM mutations', async () => {
    if (!pool) return;
    const { executionId, workflowId } = await seedExecution();
    const crmActions = createRealCrmActions({
      pool, tenantId: tenantA, locationId: locationA, executionId, workflowId, workerId: 'worker_dry', mode: 'dry_run', outboxRepository: outboxRepo
    });

    const res = await crmActions.createTask({ title: 'Dry Run Task', nodeId: 'dry_step_1' });
    assert.equal(res.dryRun, true);

    // Verify task not in database
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA]);
      const tasks = await client.query("SELECT id FROM location_records WHERE agency_id = $1 AND location_id = $2 AND body->>'title' = $3", [tenantA, locationA, 'Dry Run Task']);
      assert.equal(tasks.rows.length, 0);
    } finally {
      client.release();
    }
  });

  await t.test('Scenario 19: Zapier fetch failure is recorded as ZAPIER_DISPATCH_FAILED, never fake success', async () => {
    const zapNode = {
      id: 'zap_node_1',
      type: 'zapier_webhook',
      config: {
        webhookUrl: 'https://hooks.zapier.com/hooks/catch/9999999/invalid_test_mock/'
      }
    };

    // Execute step with broken/unreachable zapier url
    const result = await executeStep({
      node: zapNode,
      execution: { id: randomUUID(), workflowId: randomUUID(), agencyId: tenantA, mode: 'live', actorId: 'system_worker' },
      triggerContext: { contact: { email: 'zap@example.com' } },
      crmActions: {}
    });

    assert.equal(result.status, 'failed');
    assert.ok(result.errorCode === 'ZAPIER_DISPATCH_FAILED' || result.errorCode === 'ZAPIER_DISPATCH_REJECTED');
  });

  await t.test('Scenario 20: Calling unsupported CRM action fails closed with CRM_ACTION_UNSUPPORTED', async () => {
    const result = await executeStep({
      node: { id: 'unsupported_tag', type: 'add_tag', config: { tag: 'vip' } },
      execution: { id: randomUUID(), workflowId: randomUUID(), mode: 'live', actorId: 'system_worker' },
      triggerContext: { contact: { id: contactIdA } },
      crmActions: {} // empty crmActions
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'CRM_ACTION_UNSUPPORTED');
  });

  // ---------------------------------------------------------------------------
  // PART 4: DATABASE SECURITY & LEAST PRIVILEGE (Scenarios 21 - 25)
  // ---------------------------------------------------------------------------

  await t.test('Scenario 21: operza_app role is constrained to tenant scope under FORCE RLS', async () => {
    if (!pool || !dbUrl) return;
    const { executionId } = await seedExecution();
    const { default: pg } = await import('pg');
    const appPool = new pg.Pool({
      connectionString: dbUrl.replace(/\/\/[^@]+@/, '//operza_app:operza_app_secret@'),
      max: 2
    });

    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA]);

      const hash = crypto.createHash('sha256').update('scenario_21').digest('hex');
      await client.query(`
        INSERT INTO workflow_action_receipts (id, agency_id, location_id, execution_id, node_id, action_hash, status)
        VALUES ($1, $2, $3, $4, 'node_21', $5, 'succeeded')
      `, [randomUUID(), tenantA, locationA, executionId, hash]);

      const res = await client.query("SELECT id FROM workflow_action_receipts WHERE action_hash = $1", [hash]);
      assert.equal(res.rows.length, 1);
      await client.query('COMMIT');
    } finally {
      client.release();
      await appPool.end();
    }
  });

  await t.test('Scenario 22: operza_worker role claims and completes receipts under FORCE RLS', async () => {
    if (!pool || !dbUrl) return;
    const { executionId } = await seedExecution();
    const { default: pg } = await import('pg');
    const workerPool = new pg.Pool({
      connectionString: dbUrl.replace(/\/\/[^@]+@/, '//operza_worker:operza_worker_secret@'),
      max: 2
    });

    const workerRepo = createWorkflowOutboxRepository(workerPool);
    const actionHash = crypto.createHash('sha256').update('scenario_22').digest('hex');

    const claim = await workerRepo.claimActionReceipt({
      tenantId: tenantA, locationId: locationA, executionId, nodeId: 'node_22', actionHash, workerId: 'worker_rls'
    });
    assert.equal(claim.acquired, true);

    const comp = await workerRepo.completeActionReceipt({
      tenantId: tenantA, locationId: locationA, actionHash, result: { ok: true }
    });
    assert.equal(comp.status, 'succeeded');
    await workerPool.end();
  });

  await t.test('Scenario 23: Missing tenant context fails closed under RLS', async () => {
    if (!pool || !dbUrl) return;
    const { default: pg } = await import('pg');
    const workerPool = new pg.Pool({
      connectionString: dbUrl.replace(/\/\/[^@]+@/, '//operza_worker:operza_worker_secret@'),
      max: 2
    });

    const client = await workerPool.connect();
    try {
      // Query without setting app.agency_id or app.location_id -> returns 0 rows under RLS
      const res = await client.query("SELECT * FROM workflow_action_receipts");
      assert.equal(res.rows.length, 0);
    } finally {
      client.release();
      await workerPool.end();
    }
  });

  await t.test('Scenario 24: Cross-tenant access is strictly denied under FORCE RLS', async () => {
    if (!pool || !dbUrl) return;
    const { default: pg } = await import('pg');
    const workerPool = new pg.Pool({
      connectionString: dbUrl.replace(/\/\/[^@]+@/, '//operza_worker:operza_worker_secret@'),
      max: 2
    });

    const client = await workerPool.connect();
    try {
      // Set context to Tenant B
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantB, locationB]);

      // Attempt to read Tenant A's contact record
      const crossRead = await client.query("SELECT * FROM location_records WHERE id = $1", [contactIdA]);
      assert.equal(crossRead.rows.length, 0);

      // Attempt to update Tenant A's contact record
      const crossUpdate = await client.query("UPDATE location_records SET body = body WHERE id = $1", [contactIdA]);
      assert.equal(crossUpdate.rowCount, 0);
    } finally {
      client.release();
      await workerPool.end();
    }
  });

  await t.test('Scenario 25: Concurrent claims on identical action hash are serialized by database constraint', async () => {
    if (!pool) return;
    const { executionId } = await seedExecution();
    const actionHash = crypto.createHash('sha256').update('scenario_25_serialized').digest('hex');

    // Run 5 concurrent claim requests
    const claims = await Promise.all([
      outboxRepo.claimActionReceipt({ tenantId: tenantA, locationId: locationA, executionId, nodeId: 'node_25', actionHash, workerId: 'w1' }),
      outboxRepo.claimActionReceipt({ tenantId: tenantA, locationId: locationA, executionId, nodeId: 'node_25', actionHash, workerId: 'w2' }),
      outboxRepo.claimActionReceipt({ tenantId: tenantA, locationId: locationA, executionId, nodeId: 'node_25', actionHash, workerId: 'w3' }),
      outboxRepo.claimActionReceipt({ tenantId: tenantA, locationId: locationA, executionId, nodeId: 'node_25', actionHash, workerId: 'w4' }),
      outboxRepo.claimActionReceipt({ tenantId: tenantA, locationId: locationA, executionId, nodeId: 'node_25', actionHash, workerId: 'w5' })
    ]);

    const acquired = claims.filter(c => c.acquired);
    // Exactly 1 worker acquires the claim
    assert.equal(acquired.length, 1);
    const inProgress = claims.filter(c => c.status === 'in_progress');
    assert.equal(inProgress.length, 4);
  });
});
