# Observability and Operational Health — Stage 18

## 1. Health, Readiness & Metrics Endpoints (`apps/api/routes/system.mjs`)

- **Liveness (`GET /health`):** Lightweight process check returning `status: 'healthy'`, `wsEnabled`, `uptime`, and `timestamp`.
- **Readiness (`GET /ready`):** Checks PostgreSQL connectivity (`SELECT 1`) when `pgPool` is configured. Returns `503` in `staging`/`production` if PostgreSQL is unreachable; returns `200` with `dbEngine: 'json_file'` in local dev mode.
- **Metrics (`GET /metrics`):** Publicly exposes only `uptime`, `memory` (`rssMb`, `heapTotalMb`, `heapUsedMb`), and `database.engine`. **Hardened in Stage 18:** Tenant entity counts (`totalUsers`, `totalAgencies`, `totalLocations`, `records`) and `wsClients` are now gated behind `OPERZA_ADMIN_KEY` or `isPlatformAdmin`.
- **Platform Admin Telemetry (`/api/admin/queue/status`, `/api/admin/worker/status`, `/api/admin/worker/tick`):** Protected by `OPERZA_ADMIN_KEY` (minimum 32 chars, weak defaults rejected in `staging`/`production`) or `isPlatformAdmin`. Queries `worker_heartbeats` and `workflow_outbox` without leaking connection strings or secrets.

## 2. Correlation IDs & Structured Logging

- Every HTTP request receives or propagates `x-request-id` (`server.mjs` line 2926).
- Sensitive credentials are never serialized into error responses or logs.
