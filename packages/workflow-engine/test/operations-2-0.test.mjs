import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXECUTION_STATES,
  canOperatorRequeueState,
  isValidStateTransition
} from '../src/execution-state.mjs';
import {
  FAILURE_CATEGORIES,
  classifyWorkflowFailure,
  computeRetryBackoffMs,
  detectStuckExecutions,
  evaluateCancellationContract,
  evaluateRetryEligibility,
  normalizeRetryPolicy,
  sanitizeExecutionPayload
} from '../src/operations-2-0.mjs';

test('Execution State Machine supports retry_scheduled and operator requeue guard', () => {
  assert.equal(isValidStateTransition(EXECUTION_STATES.RUNNING, EXECUTION_STATES.RETRY_SCHEDULED), true);
  assert.equal(isValidStateTransition(EXECUTION_STATES.RETRY_SCHEDULED, EXECUTION_STATES.RUNNING), true);
  assert.equal(isValidStateTransition(EXECUTION_STATES.RETRY_SCHEDULED, EXECUTION_STATES.CANCELED), true);
  assert.equal(isValidStateTransition(EXECUTION_STATES.COMPLETED, EXECUTION_STATES.RETRY_SCHEDULED), false);
  assert.equal(isValidStateTransition(EXECUTION_STATES.FAILED, EXECUTION_STATES.RESUMING), false);
  assert.equal(canOperatorRequeueState(EXECUTION_STATES.FAILED), true);
  assert.equal(canOperatorRequeueState(EXECUTION_STATES.DEAD_LETTER), true);
  assert.equal(canOperatorRequeueState(EXECUTION_STATES.COMPLETED), false);
});

test('Failure classification separates transient vs permanent errors', () => {
  const rateLimit = classifyWorkflowFailure({ errorCode: 'TOO_MANY_REQUESTS', statusCode: 429 });
  assert.equal(rateLimit.category, FAILURE_CATEGORIES.RATE_LIMIT);
  assert.equal(rateLimit.retryable, true);

  const outage = classifyWorkflowFailure({ errorCode: 'PROVIDER_TIMEOUT_INDETERMINATE', statusCode: 503 });
  assert.equal(outage.category, FAILURE_CATEGORIES.PROVIDER_OUTAGE);
  assert.equal(outage.retryable, true);

  const configErr = classifyWorkflowFailure({ errorCode: 'INVALID_CONFIG' });
  assert.equal(configErr.category, FAILURE_CATEGORIES.INVALID_CONFIG);
  assert.equal(configErr.retryable, false);

  const permErr = classifyWorkflowFailure({ errorCode: 'CONSENT_REVOKED', statusCode: 403 });
  assert.equal(permErr.category, FAILURE_CATEGORIES.PERMISSION_DENIED);
  assert.equal(permErr.retryable, false);
});

test('Retry policy normalization and bounded exponential backoff', () => {
  const policy = normalizeRetryPolicy({ maxAttempts: 99, baseDelayMs: 100, maxDelayMs: 99999999, jitter: false });
  assert.equal(policy.maxAttempts, 10);
  assert.equal(policy.baseDelayMs, 1000);
  assert.equal(policy.maxDelayMs, 3_600_000);

  assert.equal(computeRetryBackoffMs({ attempt: 1, policy: { baseDelayMs: 5000, maxDelayMs: 60000, jitter: false } }), 5000);
  assert.equal(computeRetryBackoffMs({ attempt: 3, policy: { baseDelayMs: 5000, maxDelayMs: 60000, jitter: false } }), 20000);
  assert.equal(computeRetryBackoffMs({ attempt: 6, policy: { baseDelayMs: 5000, maxDelayMs: 60000, jitter: false } }), 60000);
});

test('Retry eligibility blocks permanent failures and requires confirmation for external side effects', () => {
  const perm = evaluateRetryEligibility({
    execution: { id: 'e1', status: 'failed', failureCategory: 'invalid_config', workflowVersion: 2 },
    steps: []
  });
  assert.equal(perm.eligible, false);
  assert.equal(perm.code, 'PERMANENT_FAILURE_NOT_RETRYABLE');

  const sideEffectUnconfirmed = evaluateRetryEligibility({
    execution: { id: 'e2', status: 'failed', failureCategory: 'transient_network', workflowVersion: 4 },
    steps: [{ nodeId: 'n1', nodeType: 'email', status: 'completed' }],
    receipts: [],
    confirmSideEffectRetry: false
  });
  assert.equal(sideEffectUnconfirmed.eligible, true);
  assert.equal(sideEffectUnconfirmed.requiresConfirmation, true);
  assert.equal(sideEffectUnconfirmed.code, 'SIDE_EFFECT_CONFIRMATION_REQUIRED');
  assert.equal(sideEffectUnconfirmed.preservedWorkflowVersion, 4);

  const sideEffectConfirmed = evaluateRetryEligibility({
    execution: { id: 'e2', status: 'failed', failureCategory: 'transient_network', workflowVersion: 4 },
    steps: [{ nodeId: 'n1', nodeType: 'email', status: 'completed' }],
    receipts: [{ id: 'r1', actionKey: 'k1', status: 'indeterminate' }],
    confirmSideEffectRetry: true
  });
  assert.equal(sideEffectConfirmed.eligible, true);
  assert.equal(sideEffectConfirmed.code, 'RETRY_ELIGIBLE');
  assert.equal(sideEffectConfirmed.indeterminateReceipts.length, 1);
});

test('Cancellation contract honestly distinguishes immediate, cooperative, and unsupported', () => {
  assert.equal(evaluateCancellationContract({ status: 'enqueued' }).mode, 'immediate');
  assert.equal(evaluateCancellationContract({ status: 'waiting_approval' }).mode, 'immediate');
  assert.equal(evaluateCancellationContract({ status: 'running' }).mode, 'cooperative_requested');
  assert.equal(evaluateCancellationContract({ status: 'completed' }).supported, false);
});

test('Payload sanitization redacts secrets and bounds payload size', () => {
  const clean = sanitizeExecutionPayload({
    apiKey: 'sk_live_secret',
    authorization: 'Bearer abcdef123456',
    contactId: 'c1',
    longText: 'a'.repeat(5000)
  }, 512);
  assert.equal(clean._truncated, true);
  assert.ok(!JSON.stringify(clean).includes('sk_live_secret'));
  assert.ok(!JSON.stringify(clean).includes('abcdef123456'));
});

test('Stuck execution detection flags expired leases, missing leases, stale heartbeats, and overdue retries', () => {
  const now = Date.now();
  const res = detectStuckExecutions({
    now,
    executions: [
      { id: 'r1', workflowId: 'w1', status: 'running', workerLeaseId: 'l1', leaseExpiresAt: new Date(now - 5000).toISOString() },
      { id: 'r2', workflowId: 'w1', status: 'running' },
      { id: 'r3', workflowId: 'w1', status: 'running', workerLeaseId: 'l3', leaseExpiresAt: new Date(now + 30000).toISOString(), heartbeatAt: new Date(now - 120000).toISOString() },
      { id: 'r4', workflowId: 'w1', status: 'retry_scheduled', nextRetryAt: new Date(now - 90000).toISOString() },
      { id: 'r5', workflowId: 'w1', status: 'running', workerLeaseId: 'l5', leaseExpiresAt: new Date(now + 30000).toISOString(), heartbeatAt: new Date(now - 5000).toISOString(), startedAt: new Date(now - 5000).toISOString() }
    ]
  });
  assert.equal(res.stuckCount, 4);
  assert.deepEqual(
    res.stuckExecutions.map(s => s.stuckReason),
    ['LEASE_EXPIRED', 'MISSING_LEASE', 'HEARTBEAT_STALE', 'OVERDUE_RETRY']
  );
});
