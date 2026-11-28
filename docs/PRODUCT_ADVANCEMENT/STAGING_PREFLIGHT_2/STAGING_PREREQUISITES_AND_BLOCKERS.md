# Staging Prerequisites & Blockers

1. **Terraform CLI & Remote State:** Operator workstation or CI runner with Terraform `>= 1.6.0` must run `terraform fmt -check -recursive && terraform init && terraform validate && terraform plan` (Terraform CLI is absent on this local host). Also replace `ACCOUNT_ID` in `infra/terraform/modules/iam/main.tf` with target AWS account ID / `data.aws_caller_identity`.
2. **Docker Image Builds:** Build `apps/api/Dockerfile` and `apps/web/Dockerfile` in CI Gate 3 or a host with Docker daemon running (`docker` CLI absent on this host).
3. **RDS Role Bootstrap:** Run `packages/db/scripts/bootstrap-rds-roles.sql` as `operza_rds_admin` on provisioned RDS, then execute migrations `001`–`054`.
4. **Live Redis & ClamAV Verification:** Test `DISTRIBUTED_RATE_LIMIT_STRICT=true` against ElastiCache Redis and run EICAR test against ClamAV container in staging.
5. **AWS Credentials & Secrets Manager:** Configure GitHub OIDC trust and populate the 4 Secrets Manager containers before triggering `.github/workflows/staging-deploy.yml`.
