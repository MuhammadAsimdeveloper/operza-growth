import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowOutboxRepository } from '../lib/outbox-repository.mjs';

function fakePool({ duplicateEnqueue = false, duplicateReceipt = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.includes('set_config')) return { rowCount: 0, rows: [] };
      if (sql.includes('INSERT INTO workflow_outbox')) {
        if (duplicateEnqueue) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ id: params[0], event_type: params[4], status: 'pending', attempts: 0 }] };
      }
      if (sql.includes('FROM workflow_outbox') && sql.includes('idempotency_key')) {
        return { rowCount: 1, rows: [{ id: 'existing_job', event_type: 'workflow.resume', status: 'pending', attempts: 0 }] };
      }
      if (sql.includes('WITH eligible AS')) {
        return { rowCount: 1, rows: [{ id: 'job_001', event_type: 'workflow.resume', attempts: 1 }] };
      }
      if (sql.includes('UPDATE workflow_outbox') && sql.includes('RETURNING id, status, delivered_at')) {
        return { rowCount: 1, rows: [{ id: params[0], status: 'delivered' }] };
      }
      if (sql.includes('UPDATE workflow_outbox') && sql.includes('RETURNING id, status, attempts')) {
        return { rowCount: 1, rows: [{ id: params[0], status: params[2] ? 'pending' : 'dead_letter', attempts: 2 }] };
      }
      if (sql.includes('UPDATE workflow_outbox') && sql.includes('RETURNING id')) {
        return { rowCount: 1, rows: [{ id: params[0] }] };
      }
      if (sql.includes('INSERT INTO workflow_action_receipts')) {
        if (duplicateReceipt) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ id: 'receipt_001', status: 'started', result: {} }] };
      }
      if (sql.includes('FROM workflow_action_receipts') && sql.includes('SELECT')) {
        return { rowCount: 1, rows: [{ id: 'receipt_existing', status: 'succeeded', result: { provider: 'test' }, lease_owner: null, lease_until: null }] };
      }
      if (sql.includes('UPDATE workflow_action_receipts')) {
        return { rowCount: 1, rows: [{ id: 'receipt_001', status: sql.includes('indeterminate') ? 'indeterminate' : (sql.includes('failed') ? 'failed' : 'succeeded'), result: params[3] ? JSON.parse(params[3]) : {} }] };
      }
      throw new Error('Unexpected SQL in fake outbox pool: ' + sql);
    },
    release() {}
  };
  return { calls, async connect() { return client; } };
}

const identity = {
  tenantId: 'tenant_001',
  locationId: 'location_001',
  executionId: 'execution_001'
};

test('outbox enqueue stores scoped events and deduplicates by tenant idempotency key', async () => {
  const pool = fakePool();
  const repo = createWorkflowOutboxRepository(pool);
  const result = await repo.enqueue({
    ...identity,
    eventType: 'workflow.resume',
    payload: { workflowId: 'workflow_001' },
    idempotencyKey: 'action-key-001'
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.deduplicated, false);
  assert.ok(pool.calls.some(call => call.sql.includes("set_config('app.agency_id'")));

  const duplicatePool = fakePool({ duplicateEnqueue: true });
  const duplicate = await createWorkflowOutboxRepository(duplicatePool).enqueue({
    ...identity,
    eventType: 'workflow.resume',
    payload: {},
    idempotencyKey: 'action-key-001'
  });
  assert.equal(duplicate.id, 'existing_job');
  assert.equal(duplicate.deduplicated, true);
});

test('outbox rejects secret material, malformed event types and missing idempotency keys', async () => {
  const repo = createWorkflowOutboxRepository(fakePool());
  await assert.rejects(repo.enqueue({
    ...identity, eventType: 'workflow.resume', idempotencyKey: 'action-key-002',
    payload: { config: { apiToken: 'never-store' } }
  }), { code: 'OUTBOX_CREDENTIAL_FIELD' });
  await assert.rejects(repo.enqueue({
    ...identity, eventType: 'HTTP', idempotencyKey: 'action-key-003', payload: {}
  }), { code: 'INVALID_EVENT_TYPE' });
  await assert.rejects(repo.enqueue({
    ...identity, eventType: 'workflow.resume', payload: {}
  }), { code: 'INVALID_IDEMPOTENCY_KEY' });
});

test('claim uses row locking and returns only jobs owned by the worker lease', async () => {
  const pool = fakePool();
  const result = await createWorkflowOutboxRepository(pool).claim({ workerId: 'worker_001', limit: 3, leaseMs: 10_000 });
  assert.equal(result.length, 1);
  const claimSql = pool.calls.find(call => call.sql.includes('WITH eligible AS'))?.sql || '';
  assert.match(claimSql, /FOR UPDATE SKIP LOCKED/);
  assert.match(claimSql, /lease_owner=\$1/);
});

test('worker lease can be renewed, acknowledged and failed with retry disposition', async () => {
  const pool = fakePool();
  const repo = createWorkflowOutboxRepository(pool);
  assert.equal(await repo.renewLease({ jobId: 'job_001', workerId: 'worker_001' }), true);
  assert.equal((await repo.acknowledge({ jobId: 'job_001', workerId: 'worker_001', result: { accepted: true } })).status, 'delivered');
  assert.equal((await repo.fail({ jobId: 'job_002', workerId: 'worker_001', retryable: false })).status, 'dead_letter');
});

test('action receipts are unique by action hash and completion never accepts credential-like references', async () => {
  const actionHash = 'a'.repeat(64);
  const pool = fakePool();
  const repo = createWorkflowOutboxRepository(pool);
  const receipt = await repo.claimActionReceipt({
    ...identity, nodeId: 'node_001', actionHash, providerKey: 'email.sendgrid'
  });
  assert.equal(receipt.acquired, true);
  const duplicatePool = fakePool({ duplicateReceipt: true });
  const duplicate = await createWorkflowOutboxRepository(duplicatePool).claimActionReceipt({
    ...identity, nodeId: 'node_001', actionHash, providerKey: 'email.sendgrid'
  });
  assert.equal(duplicate.acquired, false);
  assert.equal(duplicate.receipt.status, 'succeeded');
  const completed = await repo.completeActionReceipt({
    tenantId: identity.tenantId, locationId: identity.locationId,
    actionHash, claimToken: receipt.claimToken, result: { dispatch: 'accepted' }, providerReceipt: 'provider-ref-001'
  });
  assert.equal(completed.status, 'succeeded');
  const failed = await repo.failActionReceipt({
    tenantId: identity.tenantId, locationId: identity.locationId,
    actionHash, claimToken: receipt.claimToken, errorCode: 'DISPATCH_TIMEOUT', errorDetails: { message: 'Gateway timeout' }, indeterminate: true
  });
  assert.equal(failed.status, 'indeterminate');
  await assert.rejects(repo.completeActionReceipt({
    tenantId: identity.tenantId, locationId: identity.locationId,
    actionHash, claimToken: receipt.claimToken, result: {}, providerReceipt: 'Bearer secret-token'
  }), { code: 'INVALID_PROVIDER_RECEIPT' });
  await assert.rejects(repo.completeActionReceipt({
    tenantId: identity.tenantId, locationId: identity.locationId,
    actionHash, result: {}
  }), { code: 'INVALID_CLAIM_TOKEN' });
});
