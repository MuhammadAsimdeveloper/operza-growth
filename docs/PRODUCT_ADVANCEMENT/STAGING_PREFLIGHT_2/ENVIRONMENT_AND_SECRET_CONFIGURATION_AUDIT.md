# Environment & Secret Configuration Audit

Audited `.env.staging.example`, `infra/terraform/variables.tf`, `infra/terraform/modules/secrets_kms/main.tf`, and `apps/api/server.mjs` / `worker.mjs`:

- **Mandatory Secrets (no defaults in staging):** `DATABASE_URL` (`operza_app`), `WORKER_DATABASE_URL` (`operza_worker`), `MIGRATION_DATABASE_URL` (`operza_migrator`), `REDIS_URL`, `SESSION_SECRET` (32+ chars), `OPERZA_VAULT_KEY` (16+ chars, 64-hex recommended), `OPERZA_ADMIN_KEY`, `OPERZA_WEBHOOK_INGEST_SECRET`.
- **Unsafe Fallback Audit:**
  - `server.mjs` refuses JSON fallback (`store.json`) and throws `[FATAL]` when `NODE_ENV=staging` or `production` without `DATABASE_URL` or `OPERZA_VAULT_KEY`.
  - `worker.mjs` throws immediately without `WORKER_DATABASE_URL` (`operza_worker`) or `OPERZA_VAULT_KEY`.
- **Configuration Debt Noted:** `.env.staging.example` uses `PG_MAX_POOL` while `packages/db` also checks `PG_POOL_MAX`; `MIGRATION_DATABASE_URL` and `MIGRATOR_DATABASE_URL` both exist in `migrate.mjs`. Standardize in ECS task secrets.
- **Zero Secrets in IaC/Outputs:** Verified no secret values in `.tf` files, `outputs.tf`, or CI logs.
