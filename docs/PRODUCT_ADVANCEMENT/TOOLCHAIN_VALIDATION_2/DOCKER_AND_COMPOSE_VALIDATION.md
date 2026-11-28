# Docker & Compose Validation

- **`docker version` / `docker compose config`:** **NOT EXECUTED** (`docker` CLI and daemon are not installed on this Windows host).
- **YAML & Env Validation (`node scripts/validate-staging-infra.mjs`):** **PASS** on `docker-compose.staging.yml` (`worker-1` & `worker-2` receive `WORKER_DATABASE_URL`, `OPERZA_VAULT_KEY`, `WORKFLOW_JOB_MODULE`; `api` enforces `DISTRIBUTED_RATE_LIMIT_STRICT=true`, `CLAMAV_REQUIRED=true`).
