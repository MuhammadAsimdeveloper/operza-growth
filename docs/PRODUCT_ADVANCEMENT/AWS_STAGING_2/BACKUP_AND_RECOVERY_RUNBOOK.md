# Backup & Recovery Runbook

- **Targets (Not Yet Verified in AWS):** RPO <= 15 minutes (RDS PITR WAL archiving), RTO <= 1 hour.
- **RDS Backup Configuration (`modules/database`):** Automated daily backups (`backup_retention_period = 7` staging, `30` production), KMS encrypted, `skip_final_snapshot = false` & `deletion_protection = true` in production.
- **Pre-Migration Snapshot:** Before any staging/production schema migration, take an explicit manual RDS snapshot (`aws rds create-db-snapshot`).
- **PITR Restore Drill Procedure:**
  1. Restore RDS instance to target timestamp (`aws rds restore-db-instance-to-point-in-time`) into `isolated_db` subnet group.
  2. Verify `schema_migrations` latest version (`053`) and run `stage-18-hardening.test.mjs` read/RLS check against restored instance.
  3. Record actual restore duration against the 1-hour RTO target; delete scratch restored instance after sign-off.
