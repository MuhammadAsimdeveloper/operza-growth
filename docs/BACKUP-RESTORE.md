# Operza Automated Backup & Disaster Recovery Runbook

## 1. Objectives & Service Level Agreements (SLAs)

| Metric | Target SLA | Strategy |
| :--- | :--- | :--- |
| **Recovery Point Objective (RPO)** | `< 1 hour` | Daily atomic snapshot sets + WAL archiving / differential backups. |
| **Recovery Time Objective (RTO)** | `< 15 minutes` | Single-command automated restore (`npm run db:restore <backup_dir>`). |
| **Integrity Assurance** | Cryptographic SHA-256 | Every snapshot generates a signed manifest verifying file hashes before commit. |
| **Retention Policy** | Rolling 14 Days | Automatic pruning of sets older than 14 cycles. |

---

## 2. Automated Backup Execution

Operza provides a native Node.js backup engine located at `scripts/backup.mjs`:
```bash
npm run db:backup
```
### Backup Artifact Structure
Each backup creates a timestamped bundle inside `backups/backup_<YYYY-MM-DD_HH-mm-ss>/`:
```
backups/backup_2026-11-01_01-20-00/
├── postgres_dump.sql      # Transactional pg_dump of relational schema and data
├── active_state.json      # Snapshot of in-memory active tenant states and configurations
└── manifest.json          # SHA-256 cryptographic verification checksums
```

Sample `manifest.json`:
```json
{
  "timestamp": "2026-11-01T01:20:00.000Z",
  "files": {
    "postgres_dump.sql": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "active_state.json": "8a3564e9a665977fb79483017cfbf659e4b786438df050db4bb3f721e25e369b"
  }
}
```

---

## 3. Verified Disaster Recovery Procedure

To restore the system from a verified backup:
```bash
npm run db:restore backups/backup_2026-11-01_01-20-00
```
### Verification Steps Executed by `restore.mjs`:
1. **Manifest Integrity Check:** Computes real-time SHA-256 hashes of `postgres_dump.sql` and `active_state.json` and matches against `manifest.json`. If hashes fail, restoration **aborts immediately** to prevent corrupted data injection.
2. **PostgreSQL Atomic Restoration:** Restores the database under a clean transaction using `psql`.
3. **State Sync:** Restores `data/store.json` if running in fallback dev mode.
