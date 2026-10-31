# Operza — Database Backup, Disaster Recovery & Restore Runbook

## 1. Overview

Operza stores mission-critical CRM records, workflow execution history, payment orders, invoices, digital contract e-signatures, and funnel pages in PostgreSQL 16 (or local zero-config JSON file store for standalone instances). This runbook provides step-by-step procedures for automated backups, point-in-time recovery, and disaster restore with zero data loss.

---

## 2. PostgreSQL 16 Backup Procedures

### 2.1 Automated Nightly Logical Backup (`pg_dump`)

Operza recommends creating compressed logical backups using `pg_dump` with custom format (`-Fc`):

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/var/backups/operza"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${BACKUP_DIR}/operza_backup_${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"

# Execute pg_dump within docker container
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U operza_admin -d operza_db -Fc -f "/tmp/backup.dump"

# Copy archive to host backup directory
docker compose -f docker-compose.prod.yml cp postgres:/tmp/backup.dump "${FILENAME}"
docker compose -f docker-compose.prod.yml exec -T postgres rm "/tmp/backup.dump"

# Retain backups for 30 days
find "${BACKUP_DIR}" -name "operza_backup_*.dump" -mtime +30 -delete

echo "✅ Backup successfully created at: ${FILENAME}"
```

### 2.2 S3 / Object Storage Offsite Sync

Sync local backups to AWS S3, Cloudflare R2, or Google Cloud Storage:

```bash
aws s3 sync /var/backups/operza s3://operza-production-backups/postgres/ --sse aws:kms
```

---

## 3. PostgreSQL Restore Procedures

### 3.1 Disaster Recovery Full Restore

To restore Operza database from an archive file into a clean PostgreSQL instance:

```bash
# 1. Stop API server to prevent writes during restore
docker compose -f docker-compose.prod.yml stop api

# 2. Copy dump file into postgres container
docker compose -f docker-compose.prod.yml cp ./operza_backup_20261031.dump postgres:/tmp/restore.dump

# 3. Terminate active connections and recreate target database
docker compose -f docker-compose.prod.yml exec -T postgres psql -U operza_admin -d postgres <<EOF
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'operza_db';
DROP DATABASE IF EXISTS operza_db;
CREATE DATABASE operza_db OWNER operza_admin;
EOF

# 4. Restore schema, tables, and RLS policies
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U operza_admin -d operza_db --clean --if-exists --no-owner --role=operza_admin /tmp/restore.dump

# 5. Re-apply role permissions
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U operza_admin -d operza_db -f /docker-entrypoint-initdb.d/01-bootstrap-roles.sql

# 6. Restart API and verify readiness
docker compose -f docker-compose.prod.yml start api
curl -f http://localhost:4000/ready
```

---

## 4. Local File Mode Backup & Restore (`data/store.json`)

When running in zero-config single-node development or recovery mode:

### Backup
```bash
cp apps/api/data/store.json /var/backups/operza/store_$(date +"%Y%m%d_%H%M%S").json
```

### Restore
```bash
# Stop API
docker compose stop api

# Replace store file atomically
cp /var/backups/operza/store_target.json apps/api/data/store.json

# Restart API
docker compose start api
```

---

## 5. RTO / RPO Target Metrics

| Metric | Target | Verification Method |
|---|---|---|
| **RPO (Recovery Point Objective)** | < 15 Minutes | WAL archiving or periodic snapshots |
| **RTO (Recovery Time Objective)** | < 10 Minutes | `pg_restore` drill executed quarterly |
| **Integrity Verification** | 100% | Checksum validation and `TEST 1: /health` check |
