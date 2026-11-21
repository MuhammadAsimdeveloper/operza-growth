import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMemoryOutboxRepository } from '../src/outbox-worker.mjs';
import { produceWorkflowWaitResumeEvent } from '../src/outbox-producer.mjs';
import { createTrustedWorkerHandlers } from '../src/trusted-handlers.mjs';

test('produceWorkflowWaitResumeEvent: enqueues deterministic outbox continuation event', async () => {
  const repository = createMemoryOutboxRepository();
  const tenantId = '00000000-0000-4000-a000-000000000001';
  const locationId = '00000000-0000-4000-a000-000000000002';
  const workflowId = '00000000-0000-4000-a000-000000000003';
  const executionId = '00000000-0000-4000-a000-000000000004';
  const waitNodeId = 'wait_step_1';
  const resumeNodeId = 'action_step_2';
  const availableAt = new Date(Date.now() + 60_000).toISOString();

  const result = await produceWorkflowWaitResumeEvent({
    repository,
    tenantId,
    locationId,
    workflowId,
    executionId,
    waitNodeId,
    resumeNodeId,
    resumeGeneration: 1,
    availableAt
  });

  assert.ok(result.id);
  assert.equal(result.deduplicated, false);
  assert.equal(result.status, 'pending');

  // Second identical call with same generation is deduplicated
  const result2 = await produceWorkflowWaitResumeEvent({
    repository,
    tenantId,
    locationId,
    workflowId,
    executionId,
    waitNodeId,
    resumeNodeId,
    resumeGeneration: 1,
    availableAt
  });

  assert.equal(result2.deduplicated, true);
  assert.equal(result2.id, result.id);

  // Calling with next generation (e.g., generation 2) creates a distinct event
  const resultGen2 = await produceWorkflowWaitResumeEvent({
    repository,
    tenantId,
    locationId,
    workflowId,
    executionId,
    waitNodeId,
    resumeNodeId,
    resumeGeneration: 2,
    availableAt
  });

  assert.equal(resultGen2.deduplicated, false);
  assert.notEqual(resultGen2.id, result.id);
});

test('produceWorkflowWaitResumeEvent: validates required arguments', async () => {
  const repository = createMemoryOutboxRepository();
  await assert.rejects(async () => {
    await produceWorkflowWaitResumeEvent({ repository, tenantId: null, executionId: 'e1', waitNodeId: 'w1' });
  }, /tenantId, executionId, and waitNodeId are required/);

  await assert.rejects(async () => {
    await produceWorkflowWaitResumeEvent({ repository, tenantId: 't1', executionId: null, waitNodeId: 'w1' });
  }, /tenantId, executionId, and waitNodeId are required/);

  await assert.rejects(async () => {
    await produceWorkflowWaitResumeEvent({ repository, tenantId: 't1', executionId: 'e1', waitNodeId: null });
  }, /tenantId, executionId, and waitNodeId are required/);
});

test('createMemoryOutboxRepository: respects availableAt timing', async () => {
  const repository = createMemoryOutboxRepository();
  const workerId = 'worker_test_1';
  const futureTime = new Date(Date.now() + 10_000).toISOString();
  const pastTime = new Date(Date.now() - 5_000).toISOString();

  // Job 1: available in future
  await repository.enqueue({
    tenantId: 't1',
    eventType: 'workflow.wait.resume',
    idempotencyKey: 'idem_future_1',
    availableAt: futureTime,
    payload: { task: 'delayed' }
  });

  // Job 2: available now (past)
  await repository.enqueue({
    tenantId: 't1',
    eventType: 'workflow.wait.resume',
    idempotencyKey: 'idem_past_1',
    availableAt: pastTime,
    payload: { task: 'immediate' }
  });

  // Claim: only Job 2 should be claimed
  const claimed = await repository.claim({ workerId, limit: 10 });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].payload.task, 'immediate');
});

test('trusted-handlers: workflow.wait.resume executes continuation without re-running wait', async () => {
  const memoryOutbox = createMemoryOutboxRepository();
  const handlers = createTrustedWorkerHandlers({ outboxRepository: memoryOutbox });

  const executionId = randomUUID();
  const tenantId = '00000000-0000-4000-a000-000000000001';
  const locationId = '00000000-0000-4000-a000-000000000002';
  const workflowId = '00000000-0000-4000-a000-000000000003';

  const flow = {
    id: workflowId,
    name: 'Wait Resume Test Flow',
    nodes: [
      {
        id: 'start_node',
        name: 'Initial Step',
        type: 'set_variable',
        config: { name: 'accum', value: 'started' },
        next: 'wait_node'
      },
      {
        id: 'wait_node',
        name: 'Wait Step',
        type: 'wait',
        config: { durationMinutes: 10 },
        next: 'resumed_node'
      },
      {
        id: 'resumed_node',
        name: 'Resumed Action',
        type: 'set_variable',
        config: { name: 'accum', value: 'resumed_successfully' },
        next: null
      }
    ]
  };

  const resumePayload = {
    tenantId,
    locationId,
    workflowId,
    executionId,
    waitNodeId: 'wait_node',
    resumeNodeId: 'resumed_node',
    resumeGeneration: 1,
    nodes: flow.nodes,
    state: { accum: 'started' },
    triggerContext: { lead: 'test' }
  };

  const result = await handlers['workflow.wait.resume'](resumePayload, {
    job: { id: 'job_1' },
    workerId: 'worker_1',
    lease: { lost: false }
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.executionId, executionId);
  assert.equal(result.resumeNodeId, 'resumed_node');
  assert.equal(result.stepsExecuted, 1);
  assert.equal(result.timeline[0].nodeId, 'resumed_node');
  assert.equal(result.timeline[0].status, 'completed');
});

test('trusted-handlers: workflow.wait.resume handles chained waits and enqueues next continuation', async () => {
  const memoryOutbox = createMemoryOutboxRepository();
  const handlers = createTrustedWorkerHandlers({ outboxRepository: memoryOutbox });

  const executionId = randomUUID();
  const tenantId = '00000000-0000-4000-a000-000000000001';
  const locationId = '00000000-0000-4000-a000-000000000002';
  const workflowId = '00000000-0000-4000-a000-000000000003';

  const flow = {
    id: workflowId,
    name: 'Chained Wait Flow',
    nodes: [
      {
        id: 'wait_1',
        type: 'wait',
        config: { durationMinutes: 5 },
        next: 'middle_step'
      },
      {
        id: 'middle_step',
        type: 'set_variable',
        config: { name: 'stage', value: 'middle' },
        next: 'wait_2'
      },
      {
        id: 'wait_2',
        type: 'delay',
        config: { amount: 10, unit: 'minutes' },
        next: 'final_step'
      },
      {
        id: 'final_step',
        type: 'set_variable',
        config: { name: 'stage', value: 'done' },
        next: null
      }
    ]
  };

  // Resume generation 1 from middle_step
  const resumePayload = {
    tenantId,
    locationId,
    workflowId,
    executionId,
    waitNodeId: 'wait_1',
    resumeNodeId: 'middle_step',
    resumeGeneration: 1,
    nodes: flow.nodes,
    state: {},
    triggerContext: {}
  };

  const result = await handlers['workflow.wait.resume'](resumePayload, {
    job: { id: 'job_1' },
    workerId: 'worker_1',
    lease: { lost: false }
  });

  // Halts on wait_2!
  assert.equal(result.status, 'waiting');
  assert.equal(result.timeline.length, 2); // middle_step, wait_2

  // An outbox continuation for generation 2 must have been enqueued in memoryOutbox
  // Claim it with time in the future
  const claimed = await memoryOutbox.claim({ workerId: 'worker_2', limit: 10, leaseMs: 30000 });
  // Since availableAt is in the future (+10 minutes), it won't be claimed immediately
  assert.equal(claimed.length, 0);
});
