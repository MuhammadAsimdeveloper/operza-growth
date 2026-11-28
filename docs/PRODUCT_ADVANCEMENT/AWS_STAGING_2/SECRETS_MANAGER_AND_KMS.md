# Secrets Manager & KMS Integration

- **KMS Key (`modules/secrets_kms`):** `alias/operza-${var.environment}` with `enable_key_rotation = true` and `deletion_window_in_days = 30`.
- **Secrets Manager Containers (values populated out-of-band, never in Git/IaC):**
  1. `operza/${var.environment}/app-runtime`: `DATABASE_URL` (`operza_app`), `REDIS_URL`, `SESSION_SECRET`, `OPERZA_VAULT_KEY`, `OPERZA_ADMIN_KEY`, `OPERZA_WEBHOOK_INGEST_SECRET`.
  2. `operza/${var.environment}/worker-runtime`: `WORKER_DATABASE_URL` (`operza_worker`), `REDIS_URL`, `OPERZA_VAULT_KEY`.
  3. `operza/${var.environment}/migration-runtime`: `MIGRATION_DATABASE_URL` (`operza_migrator`).
  4. `operza/${var.environment}/provider-sandboxes`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `TWILIO_*`, `GOOGLE_*`, `MICROSOFT_*`, `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`.
- **Least-Privilege Access:** `api_task` role may read `app-runtime` + `provider-sandboxes`; `worker_task` role may read `worker-runtime` + `provider-sandboxes`; neither can read `migration-runtime`.
