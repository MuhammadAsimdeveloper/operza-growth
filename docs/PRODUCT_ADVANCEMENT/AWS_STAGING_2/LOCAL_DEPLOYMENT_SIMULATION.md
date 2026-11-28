# Local Deployment Simulation Results

Executed `stage20_local_sim.mjs` against `IsolatedTestPostgres` (PostgreSQL) on Windows / Node.js v24.22.0.

- **Dependencies Running:** Isolated local PostgreSQL (`IsolatedTestPostgres`), Node.js API & Worker processes.
- **Dependencies Unavailable Locally:** `docker` CLI, `terraform` CLI, live Redis server, ClamAV binary.
- **Observed Results:**
  1. **Two-Stage Database Bootstrap & Migrations:** `runMigrationPipeline` verified `postgres` superuser in Stage A, provisioned `operza_migrator` (`NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOINHERIT`), `operza_app`, `operza_worker`, and `operza_auth_definer`, and applied all **53** migrations (`001`–`053`) as `operza_migrator` cleanly.
  2. **Durable Worker (`apps/api/worker.mjs`):** Authenticated as `operza_worker`, stayed alive, and logged `Durable worker started with PostgreSQL execution engine` with all 7 handlers (`workflow.trigger.enqueued`, `workflow.step.resume`, `workflow.wait.resume`, `workflow.action.execute`, `crm.lead.qualified`, `audit.event.record`, `zapier.webhook.deliver`), `concurrency: 4`, and exited cleanly on `SIGTERM`.
  3. **API (`apps/api/server.mjs`):** In `NODE_ENV=staging` without `REDIS_URL` (`DISTRIBUTED_RATE_LIMIT_STRICT` / TLS), `server.mjs` did not bind `/health` on port `4020` (PostgreSQL API tests in `@operza/api` verify full API + PG startup in `test`/`development` mode).

*(Note: Local simulation is NOT AWS staging or ECS verification.)*
