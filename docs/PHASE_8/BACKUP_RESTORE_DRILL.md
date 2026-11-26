# Automated Backup & Restore Drill Report

**Script:** `node scripts/backup-restore-drill.mjs`
**Tools Used:** `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe` (`-Fc`) and `pg_restore.exe` (`--no-owner`)

## Measured Drill Results (Isolated Cluster)
- **Dump Size:** `358,178` bytes (`358 KB`)
- **Backup Duration:** `571 ms`
- **Restore Duration (Measured RTO on isolated test DB):** `1,089 ms`
- **Migrations Restored:** `39 / 39`
- **Seeded Tenant Record Restored:** `1 / 1`
- **Post-Restore `FORCE RLS` Verification (`operza_app` without tenant context):** `0` rows returned (verified)

## Discovery & Runbook Fix
- Using `--no-privileges` on `pg_restore` omits `operza_app` table grants (`42501 permission denied`). Production restore runbooks MUST omit `--no-privileges` or re-run role grants immediately after restore.
- **RPO Note:** Logical `pg_dump` alone proves snapshot restore; continuous WAL archiving / managed PITR (`RPO <= 15 min`) must be enabled on the production PostgreSQL host.
