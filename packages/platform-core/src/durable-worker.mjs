export class PermanentJobError extends Error {
  constructor(message, code = 'PERMANENT_JOB_FAILURE') {
    super(message);
    this.name = 'PermanentJobError';
    this.code = code;
    this.retryable = false;
  }
}

export async function runOutboxBatch({
  repository,
  workerId,
  handlers,
  limit = 10,
  leaseMs = 30_000,
  retryDelayMs = attempt => Math.min(60_000, 1_000 * (2 ** Math.max(0, attempt - 1))),
  concurrency = 4,
  heartbeatMs = Math.max(1_000, Math.floor(leaseMs / 3)),
  signal
} = {}) {
  if (!repository || typeof repository.claim !== 'function' ||
      typeof repository.acknowledge !== 'function' || typeof repository.fail !== 'function') {
    throw new TypeError('A durable outbox repository is required');
  }
  if (!workerId || typeof workerId !== 'string') throw new TypeError('workerId is required');
  if (!handlers || typeof handlers !== 'object') throw new TypeError('A trusted handler registry is required');
  const jobs = await repository.claim({ workerId, limit, leaseMs });
  let cursor = 0;
  const results = [];

  async function consume() {
    while (!signal?.aborted) {
      const index = cursor++;
      if (index >= jobs.length) return;
      const job = jobs[index];
      const handler = handlers[job.eventType];
      let leaseLost = false;
      let heartbeatBusy = false;
      const heartbeatTimer = typeof repository.renewLease === 'function'
        ? setInterval(async () => {
            if (heartbeatBusy || leaseLost || signal?.aborted) return;
            heartbeatBusy = true;
            try {
              const renewed = await repository.renewLease({ jobId: job.id, workerId, leaseMs });
              if (!renewed) leaseLost = true;
            } catch {
              leaseLost = true;
            } finally {
              heartbeatBusy = false;
            }
          }, Math.max(1_000, Number(heartbeatMs) || Math.floor(leaseMs / 3)))
        : null;
      heartbeatTimer?.unref?.();

      try {
        if (typeof handler !== 'function') throw new PermanentJobError('No trusted handler is registered for this event type', 'HANDLER_NOT_REGISTERED');
        const result = await handler(job.payload, { job, workerId, signal, lease: { get lost() { return leaseLost; } } });
        if (leaseLost) {
          results.push({ jobId: job.id, status: 'lease_lost' });
        } else {
          await repository.acknowledge({ jobId: job.id, workerId, result });
          results.push({ jobId: job.id, status: 'delivered' });
        }
      } catch (error) {
        if (leaseLost) {
          results.push({ jobId: job.id, status: 'lease_lost' });
        } else {
          const retryable = !(error instanceof PermanentJobError) && error?.retryable !== false;
          const delay = retryable ? Math.max(0, Number(retryDelayMs(job.attempts || 1, error)) || 0) : 0;
          const disposition = await repository.fail({
            jobId: job.id,
            workerId,
            errorCode: String(error?.code || 'JOB_HANDLER_FAILED').slice(0, 80),
            retryable,
            retryDelayMs: delay
          });
          results.push({ jobId: job.id, status: disposition?.status || (retryable ? 'retry' : 'dead_letter') });
        }
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
      }
    }
  }

  const count = Math.min(Math.max(1, Math.floor(concurrency)), Math.max(1, jobs.length));
  await Promise.all(Array.from({ length: jobs.length ? count : 0 }, () => consume()));
  return { claimed: jobs.length, processed: results.length, results };
}

export async function runOutboxWorker({
  repository,
  workerId,
  handlers,
  pollIntervalMs = 1_000,
  batchSize = 10,
  leaseMs = 30_000,
  concurrency = 4,
  signal,
  onError = () => {}
} = {}) {
  while (!signal?.aborted) {
    try {
      const result = await runOutboxBatch({ repository, workerId, handlers, limit: batchSize, leaseMs, concurrency, signal });
      if (result.claimed === 0) {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, pollIntervalMs);
          signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
    } catch (error) {
      onError(error);
      await new Promise(resolve => {
        const timer = setTimeout(resolve, pollIntervalMs);
        signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  }
}
