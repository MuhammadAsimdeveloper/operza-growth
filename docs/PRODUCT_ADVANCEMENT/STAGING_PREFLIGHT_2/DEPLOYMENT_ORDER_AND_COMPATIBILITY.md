# Deployment Order & Compatibility

1. **Secrets & Environment Validation** -> confirm Secrets Manager keys populated.
2. **Infrastructure Provisioning** -> operator runs `terraform plan` & `terraform apply` (staging).
3. **RDS Role Bootstrap** -> `packages/db/scripts/bootstrap-rds-roles.sql` as `operza_rds_admin`.
4. **Database Migration Job** -> `node packages/db/scripts/migrate.mjs` (`001`–`054`) as `operza_migrator`.
5. **API Rollout** -> ECS Fargate API service (`operza_app`, `/ready` probe).
6. **Worker Rollout** -> ECS Fargate Worker service (`operza_worker`).
7. **Frontend Publication** -> S3 sync + CloudFront invalidation (`apps/web/dist`, `apps/marketing/dist`).
8. **Health & Smoke Tests** -> `/health`, `/ready`, `/metrics` (non-leak), auth + PG overview (`authoritative: true`).

**Failure & Rollback Behavior:**
- If **migration fails**, abort before ECS rollout; restore pre-migration RDS snapshot if partial DDL occurred outside transaction.
- If **API/Worker health check fails**, ECS keeps previous healthy task definition active; roll back task revision. Never blindly run destructive `DROP` migrations on rollback.
