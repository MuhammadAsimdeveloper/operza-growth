import { randomUUID } from 'node:crypto';
import { runOutboxBatch } from './durable-worker.mjs';
import { trustedWorkerHandlers } from './trusted-handlers.mjs';

/**
 * In-memory transactional outbox repository for zero-config mode, local testing, and developer environments.
 * Follows the exact interface of the PostgreSQL createWorkflowOutboxRepository.
 */
export function createMemoryOutboxRepository({ initialJobs = [] } = {}) {
  const jobs = new Map(initialJobs.map(j => [j.id, { ...j }]));
  const idempotencyIndex = new Set(initialJobs.map(j => `${j.tenantId}:${j.idempotencyKey}`));

  return {
    async enqueue({ tenantId, locationId = 'default', eventType, idempotencyKey, payload = {} }) {
      if (!tenantId || !eventType || !idempotencyKey) {
        throw new TypeError('tenantId, eventType, and idempotencyKey are required');
      }

      const dedupeKey = `${tenantId}:${idempotencyKey}`;
      if (idempotencyIndex.has(dedupeKey)) {
        // Find existing job
        for (const job of jobs.values()) {
          if (job.tenantId === tenantId && job.idempotencyKey === idempotencyKey) {
            return { id: job.id, deduplicated: true, status: job.status };
          }
        }
      }

      const id = randomUUID();
      const job = {
        id,
        tenantId,
        locationId,
        eventType,
        idempotencyKey,
        payload: structuredClone(payload),
        status: 'pending',
        attempts: 0,
        workerId: null,
        leaseExpiresAt: null,
        availableAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastError: null,
        result: null
      };

      jobs.set(id, job);
      idempotencyIndex.add(dedupeKey);
      return { id, deduplicated: false, status: 'pending' };
    },

    async claim({ workerId, limit = 10, leaseMs = 30_000 } = {}) {
      if (!workerId || typeof workerId !== 'string') throw new TypeError('workerId is required');
      const now = Date.now();
      const claimed = [];

      for (const job of jobs.values()) {
        if (claimed.length >= limit) break;

        const isPending = job.status === 'pending';
        const isExpiredLease = job.status === 'claimed' && job.leaseExpiresAt && new Date(job.leaseExpiresAt).getTime() < now;
        const isRetryReady = job.status === 'retry' && job.availableAt && new Date(job.availableAt).getTime() <= now;

        if (isPending || isExpiredLease || isRetryReady) {
          job.status = 'claimed';
          job.workerId = workerId;
          job.attempts = (job.attempts || 0) + 1;
          job.leaseExpiresAt = new Date(now + leaseMs).toISOString();
          job.updatedAt = new Date(now).toISOString();
          claimed.push({ ...job });
        }
      }

      return claimed;
    },

    async renewLease({ jobId, workerId, leaseMs = 30_000 } = {}) {
      const job = jobs.get(jobId);
      if (!job || job.workerId !== workerId || job.status !== 'claimed') return false;
      job.leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
      job.updatedAt = new Date().toISOString();
      return true;
    },

    async acknowledge({ jobId, workerId, result = {} } = {}) {
      const job = jobs.get(jobId);
      if (!job || job.workerId !== workerId) throw new Error('Outbox lease lost or job missing');
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.updatedAt = new Date().toISOString();
      job.result = structuredClone(result);
      return { id: jobId, status: 'completed' };
    },

    async fail({ jobId, workerId, errorCode = 'JOB_FAILED', retryable = true, retryDelayMs = 1_000 } = {}) {
      const job = jobs.get(jobId);
      if (!job || job.workerId !== workerId) throw new Error('Outbox lease lost or job missing');

      const maxAttempts = 5;
      const willRetry = retryable && (job.attempts || 1) < maxAttempts;
      const status = willRetry ? 'retry' : 'dead_letter';

      job.status = status;
      job.lastError = errorCode;
      job.updatedAt = new Date().toISOString();
      if (willRetry) {
        job.availableAt = new Date(Date.now() + retryDelayMs).toISOString();
      }

      return { id: jobId, status, attempts: job.attempts, retryable: willRetry };
    },

    getStats() {
      const counts = { total: jobs.size, pending: 0, claimed: 0, retry: 0, completed: 0, dead_letter: 0 };
      for (const job of jobs.values()) {
        counts[job.status] = (counts[job.status] || 0) + 1;
      }
      return counts;
    },

    listJobs({ status, limit = 50 } = {}) {
      const list = Array.from(jobs.values());
      const filtered = status ? list.filter(j => j.status === status) : list;
      return filtered.slice(0, limit);
    }
  };
}

/**
 * Worker Coordinator
 * Runs a single tick or starts an autonomous processing loop.
 */
export async function executeWorkerTick({
  repository,
  workerId = `operza-worker-${randomUUID().slice(0, 8)}`,
  handlers = trustedWorkerHandlers,
  batchSize = 10,
  concurrency = 4,
  leaseMs = 30_000,
  signal
} = {}) {
  if (!repository) throw new TypeError('An outbox repository is required for worker tick');

  return runOutboxBatch({
    repository,
    workerId,
    handlers,
    limit: batchSize,
    concurrency,
    leaseMs,
    signal
  });
}
