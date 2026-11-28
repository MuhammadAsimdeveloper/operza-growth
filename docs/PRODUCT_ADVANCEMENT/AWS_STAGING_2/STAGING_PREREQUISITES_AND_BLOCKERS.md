# Staging Prerequisites & Blockers

1. **AWS Account & OIDC Trust:** Configure GitHub OIDC provider in target AWS account and set `AWS_STAGING_DEPLOY_ROLE_ARN` + `AWS_DEPLOY_ENABLED=true` in GitHub `staging` environment.
2. **Terraform CLI & Remote State:** Provision S3 state bucket + DynamoDB lock table and run `terraform init` / `terraform validate` / `terraform plan` in an environment with Terraform `>= 1.6.0`.
3. **RDS Role Bootstrap:** Execute `packages/db/scripts/bootstrap-rds-roles.sql` as `operza_rds_admin` (since RDS master user lacks `rolsuper` required by `migrate.mjs` Stage A).
4. **ClamAV & S3 Verification:** Deploy ClamAV ECS task/sidecar and run EICAR test before enabling `CLAMAV_REQUIRED=true` user uploads.
5. **Distributed Redis Test:** Verify `DISTRIBUTED_RATE_LIMIT_STRICT=true` and multi-worker BullMQ leases against ElastiCache Redis in staging.
6. **Sandbox Provider Keys & DNS:** Populate sandbox credentials and validate ACM DNS records.
