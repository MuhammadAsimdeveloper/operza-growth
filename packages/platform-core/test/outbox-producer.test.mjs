import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDeterministicIdempotencyKey,
  produceWorkflowTriggerEvent,
  produceWorkflowResumeEvent,
  produceConnectorActionEvent
} from '../src/outbox-producer.mjs';
import { handlers } from '../src/trusted-handlers.mjs';
import { runOutboxBatch, PermanentJobError } from '../src/durable-worker.mjs';

function createMockRepository() {
  const store = [];
  return {
    store,
    async enqueue({ tenantId, locationId, eventType, idempotencyKey, payload }) {
      const existing = store.find(j => j.tenantId === tenantId && j.idempotencyKey === idempotencyKey);
      if (existing) return { ...existing, deduplicated: true };
      const job = {
        id: `job_${store.length + 1}`,
        tenantId,
        locationId,
        eventType,
        idempotencyKey,
        payload,
        status: 'enqueued',
        attempts: 0,
        createdAt: new Date().toISOString()
      };
      store.push(job);
      return job;
    },
    async claim({ workerId, limit, leaseMs }) {
      const available = store.filter(j => j.status === 'enqueued' || j.status === 'retry').slice(0, limit);
      for (const j of available) {
        j.status = 'claimed';
        j.workerId = workerId;
        j.leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
      }
      return available;
    },
    async acknowledge({ jobId, workerId, result }) {
      const job = store.find(j => j.id === jobId && j.workerId === workerId);
      if (!job) throw new Error('Job not found or worker mismatch');
      job.status = 'delivered';
      job.result = result;
      return job;
    },
    async fail({ jobId, workerId, errorCode, retryable }) {
      const job = store.find(j => j.id === jobId && j.workerId === workerId);
      if (!job) throw new Error('Job not found or worker mismatch');
      job.status = retryable ? 'retry' : 'dead_letter';
      job.errorCode = errorCode;
      return job;
    },
    async renewLease({ jobId, workerId, leaseMs }) {
      const job = store.find(j => j.id === jobId && j.workerId === workerId);
      if (!job) return false;
      job.leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
      return true;
    }
  };
}

test('deterministic idempotency keys are stable and tenant-isolated', () => {
  const key1 = generateDeterministicIdempotencyKey({
    tenantId: 'tenant-alpha',
    locationId: 'loc-1',
    scope: 'workflow_trigger',
    uniqueEntityId: 'wf-99_manual',
    payloadHash: 'hash123'
  });
  const key2 = generateDeterministicIdempotencyKey({
    tenantId: 'tenant-alpha',
    locationId: 'loc-1',
    scope: 'workflow_trigger',
    uniqueEntityId: 'wf-99_manual',
    payloadHash: 'hash123'
  });
  const keyDifferentTenant = generateDeterministicIdempotencyKey({
    tenantId: 'tenant-beta',
    locationId: 'loc-1',
    scope: 'workflow_trigger',
    uniqueEntityId: 'wf-99_manual',
    payloadHash: 'hash123'
  });

  assert.equal(key1, key2, 'Same inputs must generate identical idempotency keys');
  assert.notEqual(key1, keyDifferentTenant, 'Different tenant must yield different idempotency key');
  assert.match(key1, /^idem_[a-f0-9]{64}$/);
});

test('produceWorkflowTriggerEvent enqueues outbox record and deduplicates identical calls', async () => {
  const repo = createMockRepository();
  const res1 = await produceWorkflowTriggerEvent({
    repository: repo,
    tenantId: 'tenant-alpha',
    locationId: 'loc-1',
    workflowId: 'wf-101',
    triggerType: 'form_submission',
    payload: { contactName: 'Alice', email: 'alice@example.com' }
  });

  assert.equal(res1.status, 'enqueued');
  assert.equal(res1.eventType, 'workflow.trigger.enqueued');
  assert.equal(repo.store.length, 1);

  // Re-enqueue identical event -> deduplicated
  const res2 = await produceWorkflowTriggerEvent({
    repository: repo,
    tenantId: 'tenant-alpha',
    locationId: 'loc-1',
    workflowId: 'wf-101',
    triggerType: 'form_submission',
    payload: { contactName: 'Alice', email: 'alice@example.com' }
  });

  assert.equal(res2.deduplicated, true);
  assert.equal(repo.store.length, 1, 'Duplicate enqueue must not create a second outbox record');
});

test('produceWorkflowTriggerEvent rejects payloads with secret or credential keys', async () => {
  const repo = createMockRepository();
  await assert.rejects(
    async () => {
      await produceWorkflowTriggerEvent({
        repository: repo,
        tenantId: 'tenant-alpha',
        workflowId: 'wf-101',
        payload: { apiKey: 'secret-123' }
      });
    },
    /Payload cannot contain secret or credential key: apiKey/
  );
});

test('produceWorkflowResumeEvent and produceConnectorActionEvent create valid outbox entries', async () => {
  const repo = createMockRepository();
  const resumeJob = await produceWorkflowResumeEvent({
    repository: repo,
    tenantId: 'tenant-alpha',
    workflowId: 'wf-101',
    executionId: 'exec-55',
    nodeId: 'node-approve-deal',
    actionHash: 'acthash777',
    approvedBy: 'operator-1'
  });

  assert.equal(resumeJob.eventType, 'workflow.step.resume');
  assert.equal(resumeJob.payload.executionId, 'exec-55');

  const actionJob = await produceConnectorActionEvent({
    repository: repo,
    tenantId: 'tenant-alpha',
    actionId: 'crm.tag.add',
    input: { tag: 'vip-client' },
    dryRun: true
  });

  assert.equal(actionJob.eventType, 'workflow.action.execute');
  assert.equal(actionJob.payload.dryRun, true);
});

test('trusted worker handlers process all registered event types cleanly', async () => {
  const repo = createMockRepository();
  await produceWorkflowTriggerEvent({
    repository: repo,
    tenantId: 'tenant-alpha',
    workflowId: 'wf-202',
    payload: { leadSource: 'website' }
  });
  await produceWorkflowResumeEvent({
    repository: repo,
    tenantId: 'tenant-alpha',
    workflowId: 'wf-202',
    executionId: 'exec-88',
    nodeId: 'node-approval',
    actionHash: 'hash-abc',
    approvedBy: 'reviewer-admin'
  });
  await produceConnectorActionEvent({
    repository: repo,
    tenantId: 'tenant-alpha',
    actionId: 'crm.contact.create',
    input: { email: 'test@operza.io' },
    dryRun: true
  });

  const batchResult = await runOutboxBatch({
    repository: repo,
    workerId: 'worker-unit-test-1',
    handlers,
    limit: 10
  });

  assert.equal(batchResult.claimed, 3);
  assert.equal(batchResult.processed, 3);
  assert.ok(batchResult.results.every(r => r.status === 'delivered'));
  assert.ok(repo.store.every(j => j.status === 'delivered'));
});

test('unregistered event type is rejected into dead-letter state', async () => {
  const repo = createMockRepository();
  repo.store.push({
    id: 'job_unknown',
    tenantId: 'tenant-alpha',
    eventType: 'malicious.arbitrary.code.execute',
    idempotencyKey: 'idem_unknown_999',
    payload: { code: 'process.exit(1)' },
    status: 'enqueued'
  });

  const batchResult = await runOutboxBatch({
    repository: repo,
    workerId: 'worker-unit-test-1',
    handlers,
    limit: 5
  });

  assert.equal(batchResult.claimed, 1);
  assert.equal(batchResult.results[0].status, 'dead_letter');
  assert.equal(repo.store[0].status, 'dead_letter');
  assert.equal(repo.store[0].errorCode, 'HANDLER_NOT_REGISTERED');
});
