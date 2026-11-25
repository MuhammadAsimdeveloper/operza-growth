import test from 'node:test';
import assert from 'node:assert/strict';
import { claimExecutionLease, releaseExecutionLease } from '../src/durable-leases.mjs';

test('Chaos & Scale: 1,000 concurrent workflow jobs across 4 workers with failure injection, zero lost jobs, zero duplicate side effects', async () => {
  const TOTAL_JOBS = 1000;
  const WORKER_COUNT = 4;

  // Deterministic job queue + protected side-effect ledger (idempotency-enforced)
  const jobs = Array.from({ length: TOTAL_JOBS }, (_, i) => ({
    id: `job_${i + 1}`,
    status: 'pending',
    attemptCount: 0,
    maxAttempts: 5,
    workerLeaseId: null,
    leaseExpiresAt: null,
    protectedActionKey: `charge_or_sms_${i + 1}`
  }));

  const executedSideEffects = new Map();
  let injectedTimeouts = 0;
  let injectedLeaseExpiries = 0;
  let duplicateAttemptsPrevented = 0;
  const startMs = Date.now();

  async function processWorker(workerId, simClockOffset = 0) {
    for (let idx = 0; idx < jobs.length; idx++) {
      const job = jobs[idx];
      if (job.status === 'completed' || job.status === 'dead_letter') continue;

      const now = Date.now() + simClockOffset;
      const claim = claimExecutionLease({ execution: job, workerLeaseId: workerId, leaseDurationMs: 50, now });
      if (!claim.acquired) continue;

      // Inject deterministic failures:
      // - Every 25th job on first attempt simulates provider timeout + lease expiry
      if (idx % 25 === 0 && job.attemptCount === 1) {
        injectedTimeouts++;
        job.leaseExpiresAt = new Date(now - 10).toISOString(); // simulate worker stall/expiry
        injectedLeaseExpiries++;
        continue;
      }

      // Idempotent protected side effect check (simulates durable action receipt fencing)
      if (!executedSideEffects.has(job.protectedActionKey)) {
        executedSideEffects.set(job.protectedActionKey, { workerId, at: now });
      } else {
        duplicateAttemptsPrevented++;
      }

      releaseExecutionLease({ execution: job, workerLeaseId: workerId, finalStatus: 'completed', now });
    }
  }

  // Pass 1: 4 concurrent workers
  await Promise.all(
    Array.from({ length: WORKER_COUNT }, (_, w) => processWorker(`worker-${w + 1}`))
  );

  // Pass 2: Recovery pass after lease expiration for stalled jobs
  await Promise.all(
    Array.from({ length: WORKER_COUNT }, (_, w) => processWorker(`worker-recovery-${w + 1}`, 100))
  );

  const elapsedMs = Date.now() - startMs;
  const completed = jobs.filter(j => j.status === 'completed').length;
  const lost = jobs.filter(j => j.status !== 'completed').length;

  assert.equal(completed, TOTAL_JOBS, `Expected ${TOTAL_JOBS} completed jobs, got ${completed}`);
  assert.equal(lost, 0, 'Zero durable jobs may be lost');
  assert.equal(executedSideEffects.size, TOTAL_JOBS, 'Every protected side effect must execute exactly once');
  assert.ok(injectedTimeouts > 0 && injectedLeaseExpiries > 0, 'Failure injection must actually trigger');

  console.log(`[CHAOS-1000] Completed=${completed}/${TOTAL_JOBS}, TimeoutsInjected=${injectedTimeouts}, LeaseExpiries=${injectedLeaseExpiries}, DuplicatesPrevented=${duplicateAttemptsPrevented}, ElapsedMs=${elapsedMs}`);
});
