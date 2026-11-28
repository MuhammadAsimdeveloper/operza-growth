# Container Build & Compose Validation

- **Dockerfiles Inspected:** `apps/api/Dockerfile`, `apps/web/Dockerfile`, `.dockerignore`.
- **Stage 21 Fix (`apps/api/Dockerfile`):** Added missing `apps/marketing/package.json` and `packages/ui/package.json` before `npm ci --omit=dev` so monorepo workspace resolution matches `package-lock.json`.
- **Shared Image Design:** `apps/api/Dockerfile` runs `node apps/api/server.mjs` for API and overrides `command: ["node", "apps/api/worker.mjs"]` for Worker (`USER node`, `dumb-init`, zero embedded secrets, `.dockerignore` excludes `.env*`, `.git`, `node_modules`).
- **Docker Compose (`docker-compose.staging.yml`):** YAML parsed and validated via `scripts/validate-staging-infra.mjs` (`worker-1` & `worker-2` receive `WORKER_DATABASE_URL`, `OPERZA_VAULT_KEY`, `WORKFLOW_JOB_MODULE`; `api` enforces `DISTRIBUTED_RATE_LIMIT_STRICT=true`, `CLAMAV_REQUIRED=true`).
- **Actual Container Build (`docker build` / `docker compose config`):** **NOT EXECUTED LOCALLY** (`docker` CLI absent on host; gated in CI Gate 3).
