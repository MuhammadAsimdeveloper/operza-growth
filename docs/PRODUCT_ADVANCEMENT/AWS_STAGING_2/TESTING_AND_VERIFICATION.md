# Stage 20 Testing & Verification Evidence

| Check | Command | Outcome | Notes |
| --- | --- | --- | --- |
| Infrastructure & Workflow Static Validator | `node scripts/validate-staging-infra.mjs` | **PASS (exit 0)** | Validated **15** `.tf` files, **4** `.github/workflows/*.yml` files, and `docker-compose.staging.yml`. |
| Local DB Bootstrap & Worker Simulation | `node stage20_local_sim.mjs` | **PASS (exit 0)** | Applied **53** migrations (`001`–`053`) as `operza_migrator`; `worker.mjs` authenticated as `operza_worker` and registered all 7 handlers cleanly. |
| `@operza/action-governance` | `npm --workspace=@operza/action-governance test` | **6/6 pass** | Verified |
| `@operza/workflow-engine` | `npm --workspace=@operza/workflow-engine test` | **86/86 pass** | Verified |
| `@operza/ui` | `node --test packages/ui/test/ui.test.mjs` | **1/1 pass** | Verified |
| `@operza/web` TypeScript | `npm --workspace=@operza/web run typecheck` | **PASS** | `tsc -b --noEmit` exit 0 |
| SEO Audit | `node scripts/seo-audit/run-seo-checks.mjs` | **106/106 pass** | Verified |
| `terraform validate` / `docker build` | — | **Not run locally** | `terraform` and `docker` CLIs are absent on this Windows host (gated in CI). |
