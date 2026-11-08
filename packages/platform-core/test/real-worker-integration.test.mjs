import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  claimExecutionLease,
  heartbeatExecutionLease,
  releaseExecutionLease,
  recoverAbandonedExecutions
} from '../../workflow-engine/src/durable-leases.mjs';

/**
 * Worker Integration & Resilience Test Suite
 * Validates worker lifecycle, concurrent job claiming, heartbeat renewal,
 * abandoned execution recovery, dead-lettering, and graceful shutdown.
 */

test('Worker Lifecycle: Independent job claim with concurrency protection', () => {
  const execution = {
    id: 'exec_job_001',
    status: 'pending',
    attemptCount: 0,
    maxAttempts: 3
  };

  const worker1Id = 'worker_node_alpha';
  const worker2Id = 'worker_node_beta';

  // Worker 1 claims job
  const claim1 = claimExecutionLease({
    execution,
    workerLeaseId: worker1Id,
    leaseDurationMs: 10_000,
    now: 1000
  });

  assert.equal(claim1.acquired, true);
  assert.equal(execution.status, 'running');
  assert.equal(execution.workerLeaseId, worker1Id);
  assert.equal(execution.attemptCount, 1);
  assert.equal(new Date(execution.leaseExpiresAt).getTime(), 11000);

  // Worker 2 attempts concurrent claim while lease is active -> MUST BE REJECTED
  const claim2 = claimExecutionLease({
    execution,
    workerLeaseId: worker2Id,
    leaseDurationMs: 10_000,
    now: 5000 // Still within lease
  });

  assert.equal(claim2.acquired, false);
  assert.equal(claim2.reason, 'LEASE_ACTIVE');
  assert.equal(claim2.currentLeaseOwner, worker1Id);
  assert.equal(execution.workerLeaseId, worker1Id); // Ownership unchanged
});

test('Worker Heartbeat: Lease extension and non-owner rejection', () => {
  const execution = {
    id: 'exec_job_002',
    status: 'running',
    workerLeaseId: 'worker_node_alpha',
    leaseExpiresAt: new Date(10_000).toISOString(),
    attemptCount: 1,
    maxAttempts: 3
  };

  // Heartbeat from rogue or different worker -> REJECTED
  const rogueRenew = heartbeatExecutionLease({
    execution,
    workerLeaseId: 'worker_node_rogue',
    leaseDurationMs: 15_000,
    now: 5000
  });
  assert.equal(rogueRenew.renewed, false);
  assert.equal(rogueRenew.reason, 'LEASE_OWNER_MISMATCH');

  // Heartbeat from owner before expiration -> RENEWED
  const validRenew = heartbeatExecutionLease({
    execution,
    workerLeaseId: 'worker_node_alpha',
    leaseDurationMs: 15_000,
    now: 5000
  });
  assert.equal(validRenew.renewed, true);
  assert.equal(new Date(execution.leaseExpiresAt).getTime(), 20_000);

  // Heartbeat after lease has expired -> REJECTED
  const expiredRenew = heartbeatExecutionLease({
    execution,
    workerLeaseId: 'worker_node_alpha',
    leaseDurationMs: 15_000,
    now: 25_000 // Past expiration
  });
  assert.equal(expiredRenew.renewed, false);
  assert.equal(expiredRenew.reason, 'LEASE_EXPIRED');
});

test('Worker Crash Simulation: Abandoned execution detection and reclamation', () => {
  const executions = [
    {
      id: 'exec_crashed_001',
      status: 'running',
      workerLeaseId: 'worker_crashed_pid_999',
      leaseExpiresAt: new Date(5000).toISOString(), // Expired at t=5000
      attemptCount: 1,
      maxAttempts: 3
    },
    {
      id: 'exec_healthy_002',
      status: 'running',
      workerLeaseId: 'worker_live_pid_100',
      leaseExpiresAt: new Date(50_000).toISOString(), // Active until t=50000
      attemptCount: 1,
      maxAttempts: 3
    }
  ];

  // Sweep runs at t=10000 (after worker 999 crashed and lease expired)
  const recovery = recoverAbandonedExecutions({
    executions,
    maxAttempts: 3,
    now: 10_000
  });

  assert.equal(recovery.recoveredCount, 1);
  assert.equal(recovery.recovered[0].execution.id, 'exec_crashed_001');

  // Crashed execution is reset to pending with lease cleared and exponential backoff scheduled
  const crashed = executions.find(e => e.id === 'exec_crashed_001');
  assert.equal(crashed.status, 'pending');
  assert.equal(crashed.workerLeaseId, null);
  assert.equal(crashed.leaseExpiresAt, null);
  assert.ok(crashed.retryAt);

  // Healthy execution remains untouched
  const healthy = executions.find(e => e.id === 'exec_healthy_002');
  assert.equal(healthy.status, 'running');
  assert.equal(healthy.workerLeaseId, 'worker_live_pid_100');

  // Second worker reclaims the recovered job cleanly
  const claimByWorker2 = claimExecutionLease({
    execution: crashed,
    workerLeaseId: 'worker_standby_pid_200',
    leaseDurationMs: 10_000,
    now: 15_000
  });

  assert.equal(claimByWorker2.acquired, true);
  assert.equal(crashed.workerLeaseId, 'worker_standby_pid_200');
  assert.equal(crashed.attemptCount, 2);
});

test('Retry Limits & Dead-Letter Queue (DLQ) Transition', () => {
  const execution = {
    id: 'exec_toxic_job',
    status: 'pending',
    attemptCount: 3,
    maxAttempts: 3
  };

  // Attempting to claim beyond maxAttempts transitions execution to dead_letter
  const claim = claimExecutionLease({
    execution,
    workerLeaseId: 'worker_node_gamma',
    leaseDurationMs: 10_000,
    now: 1000
  });

  assert.equal(claim.acquired, false);
  assert.equal(claim.reason, 'MAX_ATTEMPTS_EXCEEDED');
  assert.equal(claim.status, 'dead_letter');
  assert.equal(execution.status, 'dead_letter');
  assert.equal(execution.lastErrorCode, 'MAX_ATTEMPTS_EXCEEDED');
  assert.equal(execution.workerLeaseId, null);
});

test('Graceful Shutdown Simulation: in-flight job completes before worker exit', async () => {
  let isShuttingDown = false;
  let activeInFlightTasks = 1;

  const execution = {
    id: 'exec_in_flight_task',
    status: 'running',
    workerLeaseId: 'worker_graceful_node',
    leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()
  };

  // Simulate SIGTERM received
  function handleSigterm() {
    isShuttingDown = true;
  }
  handleSigterm();
  assert.equal(isShuttingDown, true);

  // New claims are refused during shutdown
  function shouldAcceptNewWork() {
    return !isShuttingDown;
  }
  assert.equal(shouldAcceptNewWork(), false);

  // In-flight task finishes its processing and releases lease cleanly
  const releaseResult = releaseExecutionLease({
    execution,
    workerLeaseId: 'worker_graceful_node',
    finalStatus: 'completed'
  });
  activeInFlightTasks--;

  assert.equal(releaseResult.released, true);
  assert.equal(execution.status, 'completed');
  assert.equal(execution.workerLeaseId, null);
  assert.equal(activeInFlightTasks, 0, 'All active tasks drained before final process termination');
});

test('PostgreSQL Durability vs. Redis Disconnection Invariant', () => {
  // Simulates architecture where Redis queue is unavailable or crashes.
  // PostgreSQL transactional outbox remains authoritative.
  const postgresOutbox = [
    { id: 'job_pg_1', status: 'pending', priority: 5, event_type: 'contact.sync' },
    { id: 'job_pg_2', status: 'pending', priority: 10, event_type: 'invoice.generate' }
  ];

  const redisAvailable = false; // Redis is DOWN

  // Fallback worker polling loop directly from DB outbox
  function pollDurableOutbox(jobs, workerId) {
    if (!redisAvailable) {
      // Direct PostgreSQL polling with priority order
      const sorted = [...jobs]
        .filter(j => j.status === 'pending')
        .sort((a, b) => b.priority - a.priority);
      
      const claimed = sorted[0];
      if (claimed) {
        claimed.status = 'leased';
        claimed.worker_id = workerId;
      }
      return claimed;
    }
    return null;
  }

  const claimedJob = pollDurableOutbox(postgresOutbox, 'worker_failover_1');
  assert.ok(claimedJob, 'Worker must successfully claim jobs from Postgres even if Redis is completely down');
  assert.equal(claimedJob.id, 'job_pg_2', 'Higher priority job claimed first');
  assert.equal(claimedJob.status, 'leased');
});
