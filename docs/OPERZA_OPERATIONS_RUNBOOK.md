# OPERZA — SITE RELIABILITY & OPERATIONS RUNBOOK

> **Production Monitoring, Telemetry & Incident Response Manual**  
> **Repository:** `https://github.com/MuhammadAsimdeveloper/operza-growth`  
> **Active Branch:** `release/production-launch`  
> **Target Availability:** 99.95% Uptime  
> **Audience:** DevOps Engineers, On-Call SREs, Systems Administrators

---

## 1. Operational Telemetry & Probes

Operza provides 3 dedicated endpoints for container orchestrators, load balancers, and monitoring agents:

### 1. Liveness Probe (`GET /health`)
- **Port:** `4000` (API) or `80` (Web Nginx Ingress)
- **Purpose:** Verifies that the Node.js event loop is responding and WebSocket server is bound.
- **Response Format:**
  ```json
  {
    "name": "Operza Unified API",
    "status": "healthy",
    "version": "2.0.0",
    "wsEnabled": true,
    "uptime": 3612.4,
    "timestamp": "2026-11-01T00:00:00.000Z"
  }
  ```

### 2. Readiness Probe (`GET /ready`)
- **Purpose:** Validates that all critical upstream dependencies (PostgreSQL database pool & Redis queue cluster) are responsive.
- **Fail-Closed Semantics:** Returns **HTTP 503 Service Unavailable** if PostgreSQL or Redis is unreachable in production.
- **Response Format:**
  ```json
  {
    "status": "ready",
    "database": "connected",
    "queueEngine": "redis_distributed",
    "queueStatus": "connected",
    "uptime": 3612.4
  }
  ```

### 3. Queue & System Metrics (`GET /metrics` & `GET /api/admin/queue/status`)
- **Purpose:** Exposes active in-flight worker count, queue depths, DLQ depth, and memory usage.
- **Response Format:**
  ```json
  {
    "queue": {
      "engine": "redis_distributed",
      "connected": true,
      "workerRunning": true,
      "activeJobsInFlight": 2,
      "readyDepth": 0,
      "delayedDepth": 4,
      "dlqDepth": 0,
      "idempotencyTracked": 18
    }
  }
  ```

---

## 2. On-Call Incident Triage Runbook

### Alert: API Readiness Probe Failing (`HTTP 503`)
1. **Check Container Logs:**
   ```bash
   docker logs operza-prod-api --tail 100 -f
   ```
2. **Inspect PostgreSQL Status:**
   ```bash
   # Verify PostgreSQL container is healthy:
   docker inspect --format='{{json .State.Health}}' operza-prod-postgres
   
   # Check active connections:
   psql "$DATABASE_URL" -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"
   ```
3. **Inspect Redis Status:**
   ```bash
   docker exec -it operza-prod-redis redis-cli ping
   # Expected output: PONG
   ```

---

### Alert: Dead-Letter Queue (DLQ) Depth Spiking (`dlqDepth > 0`)
1. **Query Dead-Lettered Jobs in Redis:**
   ```bash
   docker exec -it operza-prod-redis redis-cli LRANGE "operza:q:workflows:dlq" 0 5
   ```
2. **Analyze Failure Diagnostics:**
   Inspect the `errorReason` field in the dead-lettered job payload (e.g. invalid external API token, expired Stripe secret, or downstream network timeout).
3. **Replay DLQ Jobs:**
   Once downstream issues are resolved, move jobs from DLQ back to ready queue:
   ```bash
   docker exec -it operza-prod-redis redis-cli RPOPLPUSH "operza:q:workflows:dlq" "operza:q:workflows:ready"
   ```

---

### Alert: High Database Connection Pool Usage
1. Inspect connection count in PostgreSQL:
   ```sql
   SELECT client_addr, count(*) FROM pg_stat_activity WHERE datname = 'operza_db' GROUP BY client_addr;
   ```
2. If connection leaks are suspected, verify that `sanitizePooledClient` is being invoked in all custom database helpers.
3. Temporarily increase pool capacity if traffic surged:
   ```bash
   PG_MAX_POOL=30 docker compose -f docker-compose.prod.yml up -d
   ```

---

## 3. Maintenance Procedures

### Applying Zero-Downtime Schema Migrations
```bash
# 1. Run migrations against live database (Migration 001-008 are backward compatible)
docker exec -it operza-prod-api node scripts/migrate.mjs

# 2. Perform rolling container upgrade
docker compose -f docker-compose.prod.yml up -d --no-deps --build api worker
```

### Rotating Secrets
1. **Stripe Webhook Secret:** Update `STRIPE_WEBHOOK_SECRET` in `.env.production`. Restart API container.
2. **Session Secret:** Update `SESSION_SECRET`. Note: active user sessions will be invalidated and require re-login.
