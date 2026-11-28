# Infrastructure Architecture Audit (Preflight)

- **Baseline Commit:** `d02c860` (Stage 19 RC1) on `feat/operza-agency-launch-readiness`
- **Local Tooling Discovered:** Node.js v24.22.0, AWS CLI v2 (`aws.exe`), `yaml` package; `docker`, `terraform`, and `cdk` CLIs are **not** installed on the local Windows host.
- **Existing Container & Compose Assets:**
  - `apps/api/Dockerfile`: `node:22-alpine`, `dumb-init`, `npm ci --omit=dev`, non-root `USER node`, `/health` `HEALTHCHECK`.
  - `apps/web/Dockerfile`: Multi-stage `node:22-alpine` build -> `nginx:1.27-alpine` SPA + `/api/`, `/ws`, `/widget/` reverse proxy.
  - `docker-compose.yml`, `docker-compose.staging.yml`, `docker-compose.prod.yml`, `.env.staging.example`.
- **Stage 20 Preflight Findings Fixed:**
  1. `docker-compose.staging.yml` previously passed `DATABASE_URL` instead of `WORKER_DATABASE_URL` and omitted `OPERZA_VAULT_KEY` for `worker-1`/`worker-2` (fixed in Stage 20).
  2. `packages/db/scripts/migrate.mjs` Stage A checks `rolsuper` and installs an `EVENT TRIGGER`, which Amazon RDS master users (`rds_superuser`) lack; created `packages/db/scripts/bootstrap-rds-roles.sql` for RDS bootstrap without `SUPERUSER`.
  3. No IaC existed in the repository; added modular Terraform under `infra/terraform/`.
