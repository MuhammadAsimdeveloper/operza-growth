# Phase 8.3 — Staging Deployment Preflight

**Date:** 2026-11-26
**Branch:** `feat/operza-agency-launch-readiness`
**Starting HEAD:** `17b4d092415b4e86061db387347aa82cc5c37c2e` (`17b4d09`)
**Working Tree:** Clean (`[ahead 16]`, not pushed)

---

## 1. Host & Cloud Tooling Inventory
- **Docker / Docker Compose:** **NOT INSTALLED** on this Windows host.
- **Redis (`redis-server`) & ClamAV (`clamscan` / `clamdscan`):** **NOT INSTALLED** on this Windows host.
- **PostgreSQL 18 (`pg_dump.exe`, `pg_restore.exe`, `postgres.exe`):** Installed locally without `pgvector` (`vector.control`).
- **Cloud CLIs present:** `aws.exe`, `railway.ps1`, `gh.exe` — **no cloud provisioning executed** (requires explicit owner provider selection and cost approval).
- **CI/CD Workflows present:** `.github/workflows/ci.yml`, `codeql.yml`, `docker.yml`.

## 2. Owner Decision Required
Select target staging host (Docker VPS / AWS ECS+RDS / Railway) and approve provisioning credentials before executing `docker compose -f docker-compose.staging.yml up -d --build`.
