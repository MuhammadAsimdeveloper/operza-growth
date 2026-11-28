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
    outboxRepo,
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
    let tablesCount = 0;
    const isStagingOrProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

    if (pgPool) {
      try {
        const testRes = await pgPool.query('SELECT 1');
        if (testRes.rows.length > 0) dbStatus = 'connected';
        const tablesRes = await pgPool.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'").catch(() => ({ rows: [{ count: 0 }] }));
        tablesCount = Number(tablesRes.rows[0]?.count || 0);
      } catch {
        dbStatus = 'error';
      }
    } else {
      dbStatus = 'local_file_store';
    }

    const isReady = isStagingOrProd ? (dbStatus === 'connected') : true;
    const statusCode = isReady ? 200 : 503;

    sendJson(res, statusCode, {
      ready: isReady,
      status: isReady ? 'ready' : 'unhealthy',
      dbEngine: pgPool ? 'postgresql' : 'json_file',
      dbStatus,
      tablesCount,
      wsReady: !!wss,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
    return true;
  }

  // 3. Observability metrics (tenant entity counts require platform admin auth)
  if (pathname === '/metrics') {
    const mem = process.memoryUsage();
    const actor = getActor ? await getActor(req).catch(() => null) : null;
    const configuredAdminKey = process.env.OPERZA_ADMIN_KEY;
    const providedKey = req.headers['x-admin-key'];
    const hasAdminKey = Boolean(configuredAdminKey && configuredAdminKey.length >= 32 && providedKey && providedKey === configuredAdminKey);
    const isAdmin = hasAdminKey || Boolean(actor?.isPlatformAdmin === true || actor?.user?.isPlatformAdmin === true);

    const payload = {
      uptime: process.uptime(),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100
      },
      database: {
        engine: pgPool ? 'postgresql' : 'json_file'
      },
      timestamp: new Date().toISOString()
    };

    if (isAdmin) {
      const entityCounts = {};
      for (const [key, list] of Object.entries(state.records || {})) {
        entityCounts[key] = (list || []).length;
      }
      payload.connections = { wsClients: wsClients?.size || 0 };
      payload.database.totalUsers = (state.users || []).length;
      payload.database.totalAgencies = (state.agencies || []).length;
      payload.database.totalLocations = (state.locations || []).length;
      payload.database.records = entityCounts;
    }

    sendJson(res, 200, payload);
    return true;
  }

  // Guard: Admin routes require an authenticated platform superadmin or valid OPERZA_ADMIN_KEY.
  // Standard tenant agency owners/admins are NOT permitted to invoke platform-level operations.
  if (pathname.startsWith('/api/admin/')) {
    const actor = await getActor(req);
    const isStagingOrProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
    const disallowedKeys = new Set([
      'operza-internal-admin-telemetry-key-min-32-chars',
      'operza-admin-telemetry-secret-key-32chars',
      'admin-key',
      '12345678901234567890123456789012'
    ]);

    const configuredAdminKey = process.env.OPERZA_ADMIN_KEY;
    const isConfiguredKeyDisallowed = isStagingOrProd && (
      !configuredAdminKey ||
      configuredAdminKey.length < 32 ||
      disallowedKeys.has(configuredAdminKey)
    );

    const providedKey = req.headers['x-admin-key'];
    const hasValidAdminKey = Boolean(
      configuredAdminKey &&
      !isConfiguredKeyDisallowed &&
      providedKey &&
      providedKey === configuredAdminKey
    );

    const isPlatformAdmin = Boolean(
      actor?.user?.isPlatformAdmin === true ||
      (process.env.OPERZA_ADMIN_EMAIL && actor?.user?.email && actor.user.email.toLowerCase() === process.env.OPERZA_ADMIN_EMAIL.toLowerCase())
    );

    if (!hasValidAdminKey && !isPlatformAdmin) {
      sendJson(res, 403, {
        error: 'Platform administrative authorization required. Agency tenant credentials cannot access platform operations.',
        code: 'PLATFORM_ADMIN_REQUIRED'
      });
      return true;
    }
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
    if (pgPool) {
      try {
        const statsRes = await pgPool.query(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE status = 'leased') AS leased,
            COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
            COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter,
            COUNT(*) AS total
          FROM workflow_outbox
        `);
        const row = statsRes.rows[0] || {};
        const stats = {
          pending: Number(row.pending || 0),
          leased: Number(row.leased || 0),
          delivered: Number(row.delivered || 0),
          dead_letter: Number(row.dead_letter || 0),
          total: Number(row.total || 0)
        };

        // Query real worker heartbeat table for alive workers within last 30 seconds
        const heartbeatRes = await pgPool.query(`
          SELECT worker_id, hostname, pid, last_heartbeat_at, status, metadata,
                 EXTRACT(EPOCH FROM (now() - last_heartbeat_at))::int AS seconds_since_heartbeat
          FROM worker_heartbeats
          WHERE status = 'alive' AND last_heartbeat_at >= now() - INTERVAL '30 seconds'
          ORDER BY last_heartbeat_at DESC
          LIMIT 1
        `).catch(() => ({ rows: [] }));

        const activeWorker = heartbeatRes.rows[0];
        if (activeWorker) {
          sendJson(res, 200, {
            status: 'active',
            workerId: activeWorker.worker_id,
            lastHeartbeatAt: activeWorker.last_heartbeat_at,
            secondsSinceHeartbeat: activeWorker.seconds_since_heartbeat,
            stats,
            engine: 'postgresql'
          });
          return true;
        }

        const historicalRes = await pgPool.query(`
          SELECT worker_id, last_heartbeat_at, status
          FROM worker_heartbeats
          ORDER BY last_heartbeat_at DESC
          LIMIT 1
        `).catch(() => ({ rows: [] }));
        const lastKnown = historicalRes.rows[0];

        sendJson(res, 200, {
          status: 'inactive',
          workerId: null,
          lastKnownWorkerId: lastKnown?.worker_id || null,
          lastHeartbeatAt: lastKnown?.last_heartbeat_at || null,
          stats,
          code: 'NO_ACTIVE_WORKER_HEARTBEAT',
          message: 'No active worker heartbeat detected within the last 30 seconds',
          engine: 'postgresql'
        });
        return true;
      } catch (err) {
        console.warn('[OPERZA-ADMIN] Failed to query PostgreSQL outbox stats:', err.message);
      }
    }

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
    const activeRepo = outboxRepo || memoryOutboxRepo;
    const tickResult = await executeWorkerTick({
      repository: activeRepo,
      handlers: trustedWorkerHandlers,
      workerId: `admin-tick-${randomUUID().slice(0, 8)}`
    });

    let currentStats = memoryOutboxRepo.getStats();
    if (pgPool) {
      try {
        const statsRes = await pgPool.query(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE status = 'leased') AS leased,
            COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
            COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter,
            COUNT(*) AS total
          FROM workflow_outbox
        `);
        const row = statsRes.rows[0] || {};
        currentStats = {
          pending: Number(row.pending || 0),
          leased: Number(row.leased || 0),
          delivered: Number(row.delivered || 0),
          dead_letter: Number(row.dead_letter || 0),
          total: Number(row.total || 0)
        };
      } catch {}
    }

    sendJson(res, 200, {
      success: true,
      tick: tickResult,
      stats: currentStats
    });
    return true;
  }

  // 7. Admin Outbox Enqueue
  if (method === 'POST' && pathname === '/api/admin/outbox/enqueue') {
    const actor = await getActor(req);
    const tenantId = actor?.agency?.id || 'admin-tenant';
    const locationId = actor?.activeLocation?.id || 'default';
    const body = await readBody(req);
    const activeRepo = outboxRepo || memoryOutboxRepo;
    const enq = await activeRepo.enqueue({
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
