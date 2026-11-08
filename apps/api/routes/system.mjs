/**
 * ============================================================================
 * Operza System, Health, Readiness & Admin Telemetry Routes
 * ============================================================================
 */

export async function handleSystemRoutes(req, res, ctx) {
  const {
    pathname,
    method,
    sendJson,
    readBody,
    state,
    pgPool,
    wss,
    wsClients,
    workflowQueue,
    memoryOutboxRepo,
    trustedWorkerHandlers,
    executeWorkerTick,
    randomUUID,
    getActor
  } = ctx;

  // 1. Health check
  if (pathname === '/health') {
    sendJson(res, 200, {
      name: 'Operza Unified API',
      status: 'healthy',
      version: '2.0.0',
      wsEnabled: !!wss,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
    return true;
  }

  // 2. Readiness probe
  if (pathname === '/ready') {
    let dbStatus = 'disconnected';
    if (pgPool) {
      try {
        const testRes = await pgPool.query('SELECT 1');
        if (testRes.rows.length > 0) dbStatus = 'connected';
      } catch {
        dbStatus = 'error';
      }
    } else {
      dbStatus = 'local_file_store';
    }
    sendJson(res, 200, {
      ready: true,
      dbEngine: pgPool ? 'postgresql' : 'json_file',
      dbStatus,
      wsReady: !!wss,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
    return true;
  }

  // 3. Observability metrics
  if (pathname === '/metrics') {
    const mem = process.memoryUsage();
    const entityCounts = {};
    for (const [key, list] of Object.entries(state.records || {})) {
      entityCounts[key] = (list || []).length;
    }
    sendJson(res, 200, {
      uptime: process.uptime(),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100
      },
      connections: {
        wsClients: wsClients?.size || 0
      },
      database: {
        engine: pgPool ? 'postgresql' : 'json_file',
        totalUsers: (state.users || []).length,
        totalAgencies: (state.agencies || []).length,
        totalLocations: (state.locations || []).length,
        records: entityCounts
      },
      timestamp: new Date().toISOString()
    });
    return true;
  }

  // 4. Admin Queue Status
  if (pathname === '/api/admin/queue/status') {
    sendJson(res, 200, {
      queue: workflowQueue.getMetrics(),
      timestamp: new Date().toISOString()
    });
    return true;
  }

  // 5. Admin Worker Status
  if (pathname === '/api/admin/worker/status') {
    sendJson(res, 200, {
      status: 'active',
      workerId: 'operza-worker-tick-daemon',
      stats: memoryOutboxRepo.getStats(),
      engine: 'memory_outbox'
    });
    return true;
  }

  // 6. Admin Worker Tick
  if (method === 'POST' && pathname === '/api/admin/worker/tick') {
    const tickResult = await executeWorkerTick({
      repository: memoryOutboxRepo,
      handlers: trustedWorkerHandlers,
      workerId: `admin-tick-${randomUUID().slice(0, 8)}`
    });
    sendJson(res, 200, {
      success: true,
      tick: tickResult,
      stats: memoryOutboxRepo.getStats()
    });
    return true;
  }

  // 7. Admin Outbox Enqueue
  if (method === 'POST' && pathname === '/api/admin/outbox/enqueue') {
    const actor = getActor(req);
    const tenantId = actor?.agency?.id || 'admin-tenant';
    const locationId = actor?.activeLocation?.id || 'default';
    const body = await readBody(req);
    const enq = await memoryOutboxRepo.enqueue({
      tenantId,
      locationId,
      eventType: body.eventType || 'audit.event.record',
      idempotencyKey: body.idempotencyKey || `idem_${randomUUID()}`,
      payload: { tenantId, ...(body.payload || {}) }
    });
    sendJson(res, 201, { success: true, ...enq });
    return true;
  }

  // 8. Admin Queue Test Job
  if (method === 'POST' && pathname === '/api/admin/queue/test-job') {
    const body = await readBody(req);
    const delayMs = Number(body.delayMs) || 0;
    const opts = {
      idempotencyKey: body.idempotencyKey || req.headers['idempotency-key'] || null,
      maxRetries: body.maxRetries !== undefined ? Number(body.maxRetries) : undefined
    };
    let job;
    if (delayMs > 0) {
      job = await workflowQueue.enqueueDelayed('test_queue', body.data || { test: true }, delayMs, opts);
    } else {
      job = await workflowQueue.enqueue('test_queue', body.data || { test: true }, opts);
    }
    sendJson(res, 201, { success: true, job, metrics: workflowQueue.getMetrics() });
    return true;
  }

  // 9. Admin DB Status
  if (pathname === '/api/admin/db/status') {
    let pgInfo = { connected: false, engine: 'json_file' };
    if (pgPool) {
      try {
        const testRes = await pgPool.query('SELECT current_database(), version()');
        const tablesRes = await pgPool.query(`
          SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
        `);
        pgInfo = {
          connected: true,
          engine: 'postgresql_relational',
          database: testRes.rows[0]?.current_database,
          tableCount: tablesRes.rows.length,
          tables: tablesRes.rows.map(r => r.table_name)
        };
      } catch (err) {
        pgInfo = { connected: false, error: err.message };
      }
    }
    sendJson(res, 200, {
      db: pgInfo,
      inMemoryCollections: Object.keys(state.records || {}).length,
      timestamp: new Date().toISOString()
    });
    return true;
  }

  return false;
}
