# Environment Configuration Validation

- **Machine-Checkable Validator (`node scripts/validate-staging-infra.mjs`):** **PASS** across **49** keys in `.env.staging.example`.
- **Verified Invariants:**
  - All mandatory keys present and non-empty (`NODE_ENV`, `DATABASE_URL`, `DATABASE_SSL`, `MIGRATION_DATABASE_URL`, `WORKER_DATABASE_URL`, `REDIS_URL`, `ALLOW_IN_MEMORY_QUEUE`, `SESSION_SECRET`, `OPERZA_VAULT_KEY`, `OPERZA_ADMIN_KEY`, `ALLOWED_ORIGINS`).
  - `NODE_ENV=staging`, `ALLOW_IN_MEMORY_QUEUE=false`, `DATABASE_SSL=true`.
  - Zero secret values printed to stdout/logs.
