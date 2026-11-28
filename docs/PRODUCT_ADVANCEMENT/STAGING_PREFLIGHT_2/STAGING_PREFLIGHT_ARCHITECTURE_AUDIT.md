# Staging Preflight Architecture Audit

- **Starting Commit:** `6ee958e` (Stage 20 AWS Staging Infrastructure & Deployment Engineering 2.0)
- **Branch:** `feat/operza-agency-launch-readiness`
- **Preflight Repairs Made in Stage 21:**
  1. **Real Staging API Startup Blocker Fixed (`054_operza_app_state_table.sql`):** During `stage21_local_sim.mjs` (`NODE_ENV=staging`, `operza_app`), `server.mjs` `initDatabase()` failed because `operza_app_state` was not in migrations `001`–`053`, causing `operza_app` to attempt `CREATE TABLE` without `CREATE` privilege on `public`. Added `packages/db/migrations/054_operza_app_state_table.sql` so `operza_migrator` provisions `operza_app_state` and grants DML to `operza_app`.
  2. **API Dockerfile Workspace Completeness (`apps/api/Dockerfile`):** Added `COPY apps/marketing/package.json ./apps/marketing/` and `COPY packages/ui/package.json ./packages/ui/` before `npm ci --omit=dev` so all monorepo workspaces in `package-lock.json` are present.
