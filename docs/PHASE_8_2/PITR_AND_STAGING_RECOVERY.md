# PITR & Staging Recovery Report (Phase 8.2)

- **Target:** `RPO <= 15 minutes`, `RTO <= 1 hour`.
- **Managed PostgreSQL PITR Status:** **BLOCKED locally** (no managed cloud PostgreSQL / WAL archiving endpoint available on this Windows host).
- **Local Logical Drill Baseline (Not a Substitute for Managed PITR):** `scripts/backup-restore-drill.mjs` verified `pg_dump` (`571ms`) and `pg_restore` (`1,089ms`) across 39 migrations with `operza_app` `FORCE RLS` preserved (`0` rows without tenant context).
- **Staging Recovery Runbook:**
  - `pg_dump -Fc -f backup.dump "$APP_BACKUP_URL"`
  - `pg_restore --no-owner -d "$RESTORE_TARGET_URL" backup.dump` (omit `--no-privileges` so `operza_app` grants restore).
