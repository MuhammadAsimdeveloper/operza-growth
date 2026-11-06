import test from 'node:test';
import assert from 'node:assert/strict';
import { PermanentJobError, runOutboxBatch } from '../src/durable-worker.mjs';

function repositoryWith(jobs) {
  const state = { jobs: jobs.map(job => ({ ...job })), acked: [], failed: [] };
  return {
    state,
    async claim() { return state.jobs.splice(0, state.jobs.length); },
    async acknowledge(input) { state.acked.push(input.jobId); },
    async fail(input) { state.failed.push(input); return { status: input.retryable ? 'retry' : 'dead_letter' }; }
  };
}

test('worker acknowledges completed jobs and uses bounded concurrency', async () => {
  const repo = repositoryWith([{ id: 'job_001', eventType: 'test.ok', payload: {}, attempts: 1 }]);
  const result = await runOutboxBatch({ repository: repo, workerId: 'worker_001', handlers: { 'test.ok': async () => ({ ok: true }) } });
  assert.equal(result.processed, 1);
  assert.deepEqual(repo.state.acked, ['job_001']);
  assert.equal(repo.state.failed.length, 0);
});

test('unknown event handlers are dead-lettered instead of being executed dynamically', async () => {
  const repo = repositoryWith([{ id: 'job_002', eventType: 'untrusted.module', payload: { code: 'x' }, attempts: 1 }]);
  const result = await runOutboxBatch({ repository: repo, workerId: 'worker_001', handlers: {} });
  assert.equal(result.results[0].status, 'dead_letter');
  assert.equal(repo.state.failed[0].retryable, false);
  assert.equal(repo.state.failed[0].errorCode, 'HANDLER_NOT_REGISTERED');
});

test('transient handler failure is returned to the repository with bounded retry delay', async () => {
  const repo = repositoryWith([{ id: 'job_003', eventType: 'test.retry', payload: {}, attempts: 2 }]);
  const result = await runOutboxBatch({
    repository: repo, workerId: 'worker_001',
    handlers: { 'test.retry': async () => { throw new Error('transient'); } },
    retryDelayMs: attempt => attempt * 1000
  });
  assert.equal(result.results[0].status, 'retry');
  assert.equal(repo.state.failed[0].retryable, true);
  assert.equal(repo.state.failed[0].retryDelayMs, 2_000);
});


test('worker does not acknowledge a job after its lease is lost', async () => {
  const repo = repositoryWith([{ id: 'job_heartbeat', eventType: 'test.slow', payload: {}, attempts: 1 }]);
  let heartbeatCalls = 0;
  let acknowledged = false;
  repo.renewLease = async () => {
    heartbeatCalls += 1;
    return false;
  };
  repo.acknowledge = async () => { acknowledged = true; };
  const result = await runOutboxBatch({
    repository: repo,
    workerId: 'worker_heartbeat',
    leaseMs: 2_000,
    heartbeatMs: 1_000,
    handlers: {
      'test.slow': async () => new Promise(resolve => setTimeout(() => resolve({ ok: true }), 1_150))
    }
  });
  assert.equal(heartbeatCalls, 1);
  assert.equal(acknowledged, false);
  assert.equal(result.results[0].status, 'lease_lost');
});
