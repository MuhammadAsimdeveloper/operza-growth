# Rollback & Recovery Runbook

1. **Application Rollback (ECS):** Update ECS API and Worker services to the previous known-good task definition revision (`aws ecs update-service --force-new-deployment`).
2. **Frontend Rollback (S3 + CloudFront):** Restore previous S3 object versions for `web` / `marketing` and create a CloudFront invalidation (`/*`).
3. **Database Schema Rollback:** Never run ad-hoc destructive `DROP` commands. Restore the pre-migration RDS snapshot or execute RDS PITR to just before the migration timestamp, then update `DATABASE_URL` / redeploy prior app version.
