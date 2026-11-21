import crypto from 'node:crypto';

const SENSITIVE_KEY_PATTERN = /(?:password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie)/i;

function sha256(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

function sanitizePayload(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizePayload);

  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new TypeError(`Payload cannot contain secret or credential key: ${key}`);
    }
    clean[key] = typeof val === 'object' && val !== null ? sanitizePayload(val) : val;
  }
  return clean;
}

/**
 * Generate a deterministic idempotency key for an outbox event.
 */
export function generateDeterministicIdempotencyKey({
  tenantId,
  locationId = 'default',
  scope,
  uniqueEntityId,
  payloadHash
}) {
  if (!tenantId || !scope || !uniqueEntityId) {
    throw new TypeError('tenantId, scope, and uniqueEntityId are required to build a deterministic idempotency key');
  }
  const parts = [tenantId, locationId, scope, uniqueEntityId];
  if (payloadHash) parts.push(payloadHash);
  return `idem_${sha256(parts)}`;
}

/**
 * Transactional producer to enqueue a workflow trigger event into the outbox.
 */
export async function produceWorkflowTriggerEvent({
  repository,
  tenantId,
  locationId = 'default',
  workflowId,
  triggerType = 'manual',
  payload = {},
  correlationId
}) {
  if (!repository || typeof repository.enqueue !== 'function') {
    throw new TypeError('A valid outbox repository is required');
  }
  if (!tenantId || !workflowId) {
    throw new TypeError('tenantId and workflowId are required');
  }

  const cleanPayload = sanitizePayload(payload);
  const payloadHash = sha256(cleanPayload);
  const idempotencyKey = generateDeterministicIdempotencyKey({
    tenantId,
    locationId,
    scope: 'workflow_trigger',
    uniqueEntityId: `${workflowId}_${triggerType}`,
    payloadHash
  });

  return repository.enqueue({
    tenantId,
    locationId,
    eventType: 'workflow.trigger.enqueued',
    idempotencyKey,
    payload: {
      tenantId,
      locationId,
      workflowId,
      triggerType,
      data: cleanPayload,
      correlationId: correlationId || `corr_${crypto.randomUUID()}`,
      enqueuedAt: new Date().toISOString()
    }
  });
}

/**
 * Transactional producer to enqueue a workflow resume event after human approval.
 */
export async function produceWorkflowResumeEvent({
  repository,
  tenantId,
  locationId = 'default',
  workflowId,
  executionId,
  nodeId,
  actionHash,
  approvedBy
}) {
  if (!repository || typeof repository.enqueue !== 'function') {
    throw new TypeError('A valid outbox repository is required');
  }
  if (!tenantId || !workflowId || !executionId || !nodeId) {
    throw new TypeError('tenantId, workflowId, executionId, and nodeId are required');
  }

  const idempotencyKey = generateDeterministicIdempotencyKey({
    tenantId,
    locationId,
    scope: 'workflow_resume',
    uniqueEntityId: `${executionId}_${nodeId}_${actionHash || 'resumed'}`
  });

  return repository.enqueue({
    tenantId,
    locationId,
    eventType: 'workflow.step.resume',
    idempotencyKey,
    payload: {
      tenantId,
      locationId,
      workflowId,
      executionId,
      nodeId,
      actionHash,
      approvedBy,
      enqueuedAt: new Date().toISOString()
    }
  });
}

/**
 * Transactional producer to enqueue a governed action execution.
 */
export async function produceConnectorActionEvent({
  repository,
  tenantId,
  locationId = 'default',
  actionId,
  input = {},
  dryRun = true
}) {
  if (!repository || typeof repository.enqueue !== 'function') {
    throw new TypeError('A valid outbox repository is required');
  }
  if (!tenantId || !actionId) {
    throw new TypeError('tenantId and actionId are required');
  }

  const cleanInput = sanitizePayload(input);
  const inputHash = sha256(cleanInput);
  const idempotencyKey = generateDeterministicIdempotencyKey({
    tenantId,
    locationId,
    scope: 'connector_action',
    uniqueEntityId: actionId,
    payloadHash: inputHash
  });

  return repository.enqueue({
    tenantId,
    locationId,
    eventType: 'workflow.action.execute',
    idempotencyKey,
    payload: {
      tenantId,
      locationId,
      actionId,
      input: cleanInput,
      dryRun,
      enqueuedAt: new Date().toISOString()
    }
  });
}

/**
 * Transactional producer to enqueue a scheduled workflow continuation after a wait or delay node.
 */
export async function produceWorkflowWaitResumeEvent({
  repository,
  client,
  tenantId,
  locationId = 'default',
  workflowId,
  executionId,
  waitNodeId,
  resumeNodeId,
  resumeGeneration = 1,
  availableAt,
  correlationId
}) {
  if (!repository || typeof repository.enqueue !== 'function') {
    throw new TypeError('A valid outbox repository is required');
  }
  if (!tenantId || !executionId || !waitNodeId) {
    throw new TypeError('tenantId, executionId, and waitNodeId are required');
  }

  const generationNumber = Number(resumeGeneration) || 1;
  const idempotencyKey = generateDeterministicIdempotencyKey({
    tenantId,
    locationId,
    scope: 'workflow_wait_resume',
    uniqueEntityId: `${executionId}_${waitNodeId}_gen_${generationNumber}`
  });

  const options = client ? { client } : {};

  return repository.enqueue({
    tenantId,
    locationId,
    executionId,
    eventType: 'workflow.wait.resume',
    idempotencyKey,
    availableAt: availableAt ? new Date(availableAt).toISOString() : new Date().toISOString(),
    payload: {
      tenantId,
      locationId,
      workflowId,
      executionId,
      waitNodeId,
      resumeNodeId: resumeNodeId || null,
      resumeGeneration: generationNumber,
      correlationId: correlationId || `corr_${crypto.randomUUID()}`,
      enqueuedAt: new Date().toISOString()
    }
  }, options);
}
