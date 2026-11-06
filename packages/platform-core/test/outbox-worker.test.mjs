import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryOutboxRepository, executeWorkerTick } from '../src/outbox-worker.mjs';
import { trustedWorkerHandlers } from '../src/trusted-handlers.mjs';

test('createMemoryOutboxRepository enqueues, deduplicates and claims jobs', async () => {
  const repo = createMemoryOutboxRepository();

  // 1. Enqueue job
  const first = await repo.enqueue({
    tenantId: 'tenant-100',
    eventType: 'crm.lead.qualified',
    idempotencyKey: 'idem_test_lead_1',
    payload: { contactId: 'c-1', score: 85 }
  });
  assert.equal(first.deduplicated, false);
  assert.equal(first.status, 'pending');

  // 2. Duplicate enqueue is deduplicated
  const dup = await repo.enqueue({
    tenantId: 'tenant-100',
    eventType: 'crm.lead.qualified',
    idempotencyKey: 'idem_test_lead_1',
    payload: { contactId: 'c-1', score: 85 }
  });
  assert.equal(dup.deduplicated, true);
  assert.equal(dup.id, first.id);

  // 3. Claim job with workerId
  const claimed = await repo.claim({ workerId: 'worker-alpha', limit: 5 });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, first.id);
  assert.equal(claimed[0].workerId, 'worker-alpha');

  // 4. Acknowledge completion
  const ack = await repo.acknowledge({ jobId: first.id, workerId: 'worker-alpha', result: { success: true } });
  assert.equal(ack.status, 'completed');

  const stats = repo.getStats();
  assert.equal(stats.completed, 1);
  assert.equal(stats.pending, 0);
});

test('executeWorkerTick processes outbox batch with trusted handlers', async () => {
  const repo = createMemoryOutboxRepository();

  await repo.enqueue({
    tenantId: 'tenant-200',
    eventType: 'audit.event.record',
    idempotencyKey: 'idem_audit_event_1',
    payload: { tenantId: 'tenant-200', action: 'test.action', actorId: 'user-1' }
  });

  const tickResult = await executeWorkerTick({
    repository: repo,
    handlers: trustedWorkerHandlers,
    workerId: 'worker-test-tick'
  });

  assert.equal(tickResult.claimed, 1);
  assert.equal(tickResult.processed, 1);
  assert.equal(tickResult.results[0].status, 'delivered');

  const stats = repo.getStats();
  assert.equal(stats.completed, 1);
});
