# API & Worker Local Simulation (`stage21_local_sim.mjs`)

Executed against `IsolatedTestPostgres` with `NODE_ENV=staging`, `operza_app` (`DATABASE_URL`), `operza_worker` (`WORKER_DATABASE_URL`), random 32-byte `SESSION_SECRET` & `OPERZA_VAULT_KEY`.

- **Role Verification:** `operza_app` (`rolsuper=false, rolbypassrls=false`), `operza_worker` (`rolsuper=false, rolbypassrls=false`).
- **Tenant Isolation:** Agency B querying `location_records` seeded for Agency A via `runInTenantTx` under `operza_app` returned **`0` rows**.
- **API Startup (`apps/api/server.mjs`):**
  - `GET /health` -> `200` (`status: "healthy"`, `wsEnabled: true`).
  - `GET /ready` -> `200` (`ready: true`, `status: "ready"`, `dbEngine: "postgresql"`, `dbStatus: "connected"`, `tablesCount: 118`).
- **Worker Startup (`apps/api/worker.mjs`):**
  - Authenticated as `operza_worker`, registered all 7 durable handlers (`workflow.trigger.enqueued`, `workflow.step.resume`, `workflow.wait.resume`, `workflow.action.execute`, `crm.lead.qualified`, `audit.event.record`, `zapier.webhook.deliver`), `concurrency: 4`.
- **Graceful Shutdown:** Both API and Worker terminated cleanly on `SIGTERM`.
