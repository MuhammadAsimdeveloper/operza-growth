# Stage 22 Testing & Verification Evidence

| Check | Command | Outcome | Scope & Notes |
| --- | --- | --- | --- |
| Infra, Workflow, Compose & Env Validator | `node scripts/validate-staging-infra.mjs` | **PASS (exit 0)** | 15 `.tf` files, 4 `.yml` workflows, `docker-compose.staging.yml`, 49 `.env.staging.example` keys. |
| Upgrade `001`–`053` -> `054` & Fail-Closed Suite | `node stage22_verify.mjs` | **PASS (exit 0)** | `operza_migrator` upgrade to 54 migrations, `operza_app_state` owner=`operza_migrator`, `operza_app` SELECT OK; Redis `RATE_LIMIT_BACKEND_UNAVAILABLE`; ClamAV `unavailable`. |
| Stage 18 Hardening & FORCE RLS | `node --test packages/platform-core/test/stage-18-hardening.test.mjs` | **PASS (2/2)** | `p50=4.61ms`, `p95=6.88ms`, 100% FORCE RLS across 126 `agency_id` tables. |
| `terraform` / `docker` / `redis` / `clamdscan` | — | **Not run locally** | Binaries missing on Windows host (WSL2 not enabled). |
