# Staging Deployment Runbook

1. **Pre-Flight:** Ensure all CI gates pass on target commit and `terraform plan -var-file=environments/staging/terraform.tfvars` is reviewed.
2. **Provision Infrastructure (First Time):** Run `terraform apply` for staging; note outputs (`rds_endpoint`, `redis_primary_endpoint`, `uploads_bucket_name`, `github_deploy_role_arn`).
3. **Bootstrap RDS Roles:** Connect as `operza_rds_admin` and run `packages/db/scripts/bootstrap-rds-roles.sql` with generated passwords.
4. **Populate Secrets Manager:** Store `app-runtime`, `worker-runtime`, `migration-runtime`, and `provider-sandboxes` JSON secrets.
5. **Trigger Staging Workflow:** Run `.github/workflows/staging-deploy.yml` (`confirm_staging = STAGING`), approve Gate 4 (`staging` environment), execute migration task (`001`–`053`), roll out ECS API + Worker, sync `apps/web/dist` and `apps/marketing/dist` to S3 + invalidate CloudFront.
6. **Verify Smoke Tests:** `GET /health`, `GET /ready`, unauthenticated `GET /metrics` (no `totalUsers`), signup/login + `/api/reports/v2/overview` (`authoritative: true`).
