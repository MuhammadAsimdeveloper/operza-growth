import pg from 'pg';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWorkflowOutboxRepository } from '../../packages/db/lib/outbox-repository.mjs';
import { runOutboxWorker } from '../../packages/platform-core/src/durable-worker.mjs';

const { Pool } = pg;

export async function startDurableWorker({
  databaseUrl = process.env.WORKER_DATABASE_URL,
  handlerModule = process.env.WORKFLOW_JOB_MODULE,
  workerId = process.env.WORKER_ID || 'operza-worker-' + randomUUID(),
  poolOptions = {}
} = {}) {
  if (!databaseUrl) throw new Error('WORKER_DATABASE_URL is required; do not use the API application connection string.');
  if (!handlerModule) throw new Error('WORKFLOW_JOB_MODULE must point to a trusted local module exporting a handlers object.');

  const moduleUrl = pathToFileURL(path.resolve(process.cwd(), handlerModule)).href;
  const loaded = await import(moduleUrl);
  const handlers = loaded.handlers || loaded.default?.handlers;
  if (!handlers || typeof handlers !== 'object' || Object.keys(handlers).length === 0) {
    throw new Error('The trusted worker module must export at least one named handler.');
  }
  for (const [eventType, handler] of Object.entries(handlers)) {
    if (!/^[a-z][a-z0-9_.-]{1,120}$/.test(eventType) || typeof handler !== 'function') {
      throw new Error('Worker handlers must be a map of event type to function.');
    }
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.WORKER_DB_POOL_MAX || 4),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined,
    ...poolOptions
  });
  const controller = new AbortController();
  let closing = false;

  try {
    const identity = await pool.query('SELECT current_user AS role');
    if (identity.rows[0]?.role !== 'operza_worker') {
      throw new Error('WORKER_DATABASE_URL must authenticate as the separately provisioned operza_worker role.');
    }

    const repository = createWorkflowOutboxRepository(pool);
    const shutdown = () => {
      if (closing) return;
      closing = true;
      controller.abort();
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);

    console.log(JSON.stringify({
      level: 'INFO',
      message: 'Durable workflow worker started',
      workerId,
      handlers: Object.keys(handlers),
      concurrency: Number(process.env.WORKER_CONCURRENCY || 4)
    }));

    await runOutboxWorker({
      repository,
      workerId,
      handlers,
      pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS || 1_000),
      batchSize: Number(process.env.WORKER_BATCH_SIZE || 10),
      leaseMs: Number(process.env.WORKER_LEASE_MS || 30_000),
      concurrency: Number(process.env.WORKER_CONCURRENCY || 4),
      signal: controller.signal,
      onError: error => console.error(JSON.stringify({
        level: 'ERROR',
        message: 'Durable worker batch failed',
        code: error?.code || 'WORKER_BATCH_FAILED'
      }))
    });
  } finally {
    controller.abort();
    await pool.end();
    console.log(JSON.stringify({ level: 'INFO', message: 'Durable workflow worker stopped', workerId }));
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  startDurableWorker().catch(error => {
    console.error(JSON.stringify({
      level: 'ERROR',
      message: 'Durable workflow worker could not start',
      code: error?.code || 'WORKER_START_FAILED',
      detail: error.message
    }));
    process.exitCode = 1;
  });
}
