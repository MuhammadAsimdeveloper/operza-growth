# Backup & Recovery Readiness

- **Targets (Not Yet Verified in AWS):** RPO <= 15 minutes (RDS WAL archiving + PITR), RTO <= 1 hour.
- **Configuration Verified in Terraform (`modules/database/main.tf`):** `backup_retention_period = 7` (staging) / `30` (production), `storage_encrypted = true` (KMS), `deletion_protection = true` & `skip_final_snapshot = false` in production.
- **Restore & Outbox Safety:** After PITR restore, verify `operza_app` / `operza_worker` / `operza_migrator` roles exist, check `schema_migrations`, and start workers (`action_receipts` + idempotency keys prevent duplicate external side effects on outbox replay).
- **Status:** PITR restore drill has **not** been executed (requires live AWS RDS instance).
