/**
 * Durable Workflow Execution Lease & Abandoned Task Recovery Engine
 * Implements deterministic lease acquisition, heartbeats, and exponential backoff recovery.
 */

import { randomUUID } from 'node:crypto';

export function claimExecutionLease({
  execution,
  workerLeaseId,
  leaseDurationMs = 30_000,
  now = Date.now()
}) {
  if (!execution) throw new TypeError('execution is required');
  if (!workerLeaseId) throw new TypeError('workerLeaseId is required');

  const isPending = execution.status === 'pending';
  const isResuming = execution.status === 'resuming';
  const isExpired = execution.leaseExpiresAt && new Date(execution.leaseExpiresAt).getTime() <= now;
  const isRunningWithoutLease = execution.status === 'running' && (!execution.workerLeaseId || isExpired);

  if (!isPending && !isResuming && !isRunningWithoutLease && !isExpired) {
    return {
      acquired: false,
      reason: 'LEASE_ACTIVE',
      currentLeaseOwner: execution.workerLeaseId,
      expiresAt: execution.leaseExpiresAt
    };
  }

  const attempts = (execution.attemptCount || execution.attempts || 0) + 1;
  const maxAttempts = execution.maxAttempts || 3;

  if (attempts > maxAttempts) {
    execution.status = 'dead_letter';
    execution.lastErrorCode = 'MAX_ATTEMPTS_EXCEEDED';
    execution.workerLeaseId = null;
    execution.leaseExpiresAt = null;
    return {
      acquired: false,
      reason: 'MAX_ATTEMPTS_EXCEEDED',
      status: 'dead_letter'
    };
  }

  execution.workerLeaseId = workerLeaseId;
  execution.status = 'running';
  execution.attemptCount = attempts;
  execution.attempts = attempts;
  execution.heartbeatAt = new Date(now).toISOString();
  execution.leaseExpiresAt = new Date(now + leaseDurationMs).toISOString();

  return {
    acquired: true,
    execution
  };
}

export function heartbeatExecutionLease({
  execution,
  workerLeaseId,
  leaseDurationMs = 30_000,
  now = Date.now()
}) {
  if (!execution) throw new TypeError('execution is required');
  if (execution.workerLeaseId !== workerLeaseId) {
    return { renewed: false, reason: 'LEASE_OWNER_MISMATCH' };
  }

  const isExpired = execution.leaseExpiresAt && new Date(execution.leaseExpiresAt).getTime() <= now;
  if (isExpired) {
    return { renewed: false, reason: 'LEASE_EXPIRED' };
  }

  execution.heartbeatAt = new Date(now).toISOString();
  execution.leaseExpiresAt = new Date(now + leaseDurationMs).toISOString();

  return {
    renewed: true,
    leaseExpiresAt: execution.leaseExpiresAt
  };
}

export function releaseExecutionLease({
  execution,
  workerLeaseId,
  finalStatus = 'completed',
  errorCode = null,
  now = Date.now()
}) {
  if (!execution) throw new TypeError('execution is required');
  if (execution.workerLeaseId && execution.workerLeaseId !== workerLeaseId) {
    return { released: false, reason: 'LEASE_OWNER_MISMATCH' };
  }

  execution.workerLeaseId = null;
  execution.leaseExpiresAt = null;
  execution.status = finalStatus;
  execution.updatedAt = new Date(now).toISOString();

  if (errorCode) {
    execution.lastErrorCode = errorCode;
  }
  if (finalStatus === 'completed' || finalStatus === 'failed' || finalStatus === 'dead_letter') {
    execution.finishedAt = new Date(now).toISOString();
  }

  return { released: true, execution };
}

export function recoverAbandonedExecutions({
  executions = [],
  maxAttempts = 3,
  now = Date.now()
}) {
  const recovered = [];
  const deadLettered = [];

  for (const execution of executions) {
    if (!['running', 'resuming'].includes(execution.status)) continue;

    const leaseExpired = execution.leaseExpiresAt && new Date(execution.leaseExpiresAt).getTime() <= now;
    const missingLease = !execution.leaseExpiresAt && !execution.workerLeaseId;

    if (leaseExpired || missingLease) {
      const attempts = execution.attemptCount || execution.attempts || 1;
      if (attempts >= maxAttempts) {
        execution.status = 'dead_letter';
        execution.lastErrorCode = 'LEASE_TIMEOUT_EXCEEDED';
        execution.workerLeaseId = null;
        execution.leaseExpiresAt = null;
        execution.finishedAt = new Date(now).toISOString();
        deadLettered.push(execution);
      } else {
        const delayMs = Math.min(60_000, 1_000 * Math.pow(2, attempts));
        execution.status = 'pending';
        execution.workerLeaseId = null;
        execution.leaseExpiresAt = null;
        execution.retryAt = new Date(now + delayMs).toISOString();
        recovered.push({ execution, retryAt: execution.retryAt, backoffMs: delayMs });
      }
    }
  }

  return {
    recoveredCount: recovered.length,
    deadLetteredCount: deadLettered.length,
    recovered,
    deadLettered
  };
}
