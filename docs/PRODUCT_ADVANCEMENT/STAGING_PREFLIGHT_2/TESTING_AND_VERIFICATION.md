# Stage 21 Testing & Verification Evidence

| Check | Command | Outcome | Notes |
| --- | --- | --- | --- |
| Local Staging Simulation | `node stage21_local_sim.mjs` | **PASS (exit 0)** | 54 migrations (`001`–`054`) as `operza_migrator`; `NODE_ENV=staging` API `/health` (`200`) & `/ready` (`200`, PostgreSQL) as `operza_app`; `worker.mjs` as `operza_worker` (7 handlers); cross-tenant leak `0`; `SIGTERM` clean shutdown. |
| Stage 18 Hardening & FORCE RLS | `node --test packages/platform-core/test/stage-18-hardening.test.mjs` | **PASS (2/2)** | `p50=4.61ms`, `p95=6.88ms`; 100% FORCE RLS across all 126 `agency_id` tables after Migration `054`. |
| Infra & Workflow Validator | `node scripts/validate-staging-infra.mjs` | **PASS (exit 0)** | 15 `.tf` files, 4 `.github/workflows/*.yml` files, `docker-compose.staging.yml`. |
| `terraform validate` / `docker build` / `redis` / `clamav` | — | **Not run locally** | `terraform`, `docker`, `redis-server`, `clamdscan` binaries are not installed on this Windows host. |
