# AWS Staging Execution Plan (No Provisioning Performed)

> **Status:** Planning document only. Zero AWS resources have been provisioned or deployed.

## 1. Deployment Sequence (When Approved for Staging)

1. **Network & Security Baseline:** Provision VPC (public ALB/NAT subnets, private ECS subnets, isolated DB subnets), Security Groups, ACM TLS certificates, and AWS WAF.
2. **Data & State Layer:**
   - Provision RDS PostgreSQL 16 (private subnet, `sslmode=require`, automated backups + PITR).
   - Bootstrap `operza_app`, `operza_worker`, and `operza_auth_definer` roles (`NOBYPASSRLS`).
   - Provision ElastiCache Redis 7 (TLS + AUTH) and private S3 bucket (SSE-KMS, block public access).
3. **Secrets & Config:** Populate AWS Secrets Manager with `DATABASE_URL`, `WORKER_DATABASE_URL`, `MIGRATION_DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `OPERZA_VAULT_KEY`, `OPERZA_ADMIN_KEY`, `OPERZA_WEBHOOK_INGEST_SECRET`, and sandbox provider keys.
4. **Database Migration:** Run `node packages/db/scripts/migrate.mjs` (`001`–`053`) from a one-off CI/ECS migration task using `MIGRATION_DATABASE_URL`.
5. **Compute & Static Hosting:**
   - Deploy `apps/api` and `apps/api` worker (`npm run worker`) to ECS Fargate behind ALB (`/health` & `/ready` probes).
   - Deploy `apps/web/dist` and `apps/marketing/dist` to S3 + CloudFront (OAC).

## 2. Rollback, Backup & Smoke Test Checklist

- **Database Rollback:** Restore pre-migration RDS snapshot or PITR; never run destructive `DROP` scripts on staging data.
- **Application Rollback:** Revert ECS task definition revision to prior image tag; invalidate CloudFront if static bundle rolled back.
- **Staging Smoke Tests (Post-Deploy):**
  1. `GET /health` -> `200` (`status: healthy`)
  2. `GET /ready` -> `200` (PostgreSQL + Redis connected)
  3. `GET /metrics` (unauthenticated) -> `200` without `totalUsers`
  4. Auth signup/login + CSRF + `/api/reports/v2/overview` shows `source: 'postgresql'`, `authoritative: true`
  5. Worker outbox tick claims and completes an `audit.event.record` job via `operza_worker`.
