import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimExecutionLease,
  heartbeatExecutionLease,
  releaseExecutionLease,
  recoverAbandonedExecutions
} from '../src/durable-leases.mjs';

test('claimExecutionLease: claims pending execution and sets heartbeat and lease time', () => {
  const execution = {
    id: 'exec_1',
    agencyId: 'agency_1',
    locationId: 'loc_1',
    status: 'pending',
    attempts: 0
  };

  const now = 1_000_000;
  const res = claimExecutionLease({ execution, workerLeaseId: 'worker_node_a', leaseDurationMs: 15_000, now });

  assert.equal(res.acquired, true);
  assert.equal(execution.workerLeaseId, 'worker_node_a');
  assert.equal(execution.status, 'running');
  assert.equal(execution.attemptCount, 1);
  assert.equal(new Date(execution.leaseExpiresAt).getTime(), now + 15_000);
});

test('claimExecutionLease: rejects second worker while lease is active', () => {
  const now = 1_000_000;
  const execution = {
    id: 'exec_1',
    status: 'running',
    workerLeaseId: 'worker_node_a',
    leaseExpiresAt: new Date(now + 10_000).toISOString(),
    attemptCount: 1
  };

  const res = claimExecutionLease({ execution, workerLeaseId: 'worker_node_b', now });
  assert.equal(res.acquired, false);
  assert.equal(res.reason, 'LEASE_ACTIVE');
  assert.equal(execution.workerLeaseId, 'worker_node_a');
});

test('heartbeatExecutionLease: extends active lease if owned by caller', () => {
  const now = 1_000_000;
  const execution = {
    id: 'exec_1',
    workerLeaseId: 'worker_node_a',
    leaseExpiresAt: new Date(now + 5_000).toISOString()
  };

  const res = heartbeatExecutionLease({ execution, workerLeaseId: 'worker_node_a', leaseDurationMs: 20_000, now });
  assert.equal(res.renewed, true);
  assert.equal(new Date(execution.leaseExpiresAt).getTime(), now + 20_000);
});

test('heartbeatExecutionLease: rejects lease renewal if worker id does not match', () => {
  const now = 1_000_000;
  const execution = {
    id: 'exec_1',
    workerLeaseId: 'worker_node_a',
    leaseExpiresAt: new Date(now + 5_000).toISOString()
  };

  const res = heartbeatExecutionLease({ execution, workerLeaseId: 'worker_node_imposter', now });
  assert.equal(res.renewed, false);
  assert.equal(res.reason, 'LEASE_OWNER_MISMATCH');
});

test('releaseExecutionLease: frees lease and sets final status', () => {
  const now = 1_000_000;
  const execution = {
    id: 'exec_1',
    workerLeaseId: 'worker_node_a',
    status: 'running',
    leaseExpiresAt: new Date(now + 5_000).toISOString()
  };

  const res = releaseExecutionLease({ execution, workerLeaseId: 'worker_node_a', finalStatus: 'completed', now });
  assert.equal(res.released, true);
  assert.equal(execution.status, 'completed');
  assert.equal(execution.workerLeaseId, null);
  assert.equal(execution.leaseExpiresAt, null);
  assert.ok(execution.finishedAt);
});

test('recoverAbandonedExecutions: reclaims expired running tasks with exponential backoff and dead-letters on max attempts', () => {
  const now = 1_000_000;
  const expiredRecoverable = {
    id: 'exec_abandoned_1',
    status: 'running',
    workerLeaseId: 'dead_worker_1',
    leaseExpiresAt: new Date(now - 1_000).toISOString(),
    attemptCount: 1,
    maxAttempts: 3
  };

  const expiredExhausted = {
    id: 'exec_abandoned_2',
    status: 'running',
    workerLeaseId: 'dead_worker_2',
    leaseExpiresAt: new Date(now - 1_000).toISOString(),
    attemptCount: 3,
    maxAttempts: 3
  };

  const stillActive = {
    id: 'exec_healthy',
    status: 'running',
    workerLeaseId: 'healthy_worker',
    leaseExpiresAt: new Date(now + 10_000).toISOString(),
    attemptCount: 1,
    maxAttempts: 3
  };

  const result = recoverAbandonedExecutions({
    executions: [expiredRecoverable, expiredExhausted, stillActive],
    maxAttempts: 3,
    now
  });

  assert.equal(result.recoveredCount, 1);
  assert.equal(result.deadLetteredCount, 1);

  // Verify recoverable job reset to pending with exponential backoff delay (1000 * 2^1 = 2000ms)
  assert.equal(expiredRecoverable.status, 'pending');
  assert.equal(expiredRecoverable.workerLeaseId, null);
  assert.equal(new Date(expiredRecoverable.retryAt).getTime(), now + 2000);

  // Verify exhausted job dead-lettered
  assert.equal(expiredExhausted.status, 'dead_letter');
  assert.equal(expiredExhausted.lastErrorCode, 'LEASE_TIMEOUT_EXCEEDED');

  // Verify healthy job untouched
  assert.equal(stillActive.status, 'running');
  assert.equal(stillActive.workerLeaseId, 'healthy_worker');
});
