# Staging Security Checklist (Verified by `scripts/validate-staging-infra.mjs`)

- [x] **No public RDS exposure:** `publicly_accessible = false` in `modules/database/main.tf`, placed in `isolated_db` subnets.
- [x] **No public Redis exposure:** `modules/redis/main.tf` placed in `isolated_db` subnets, SG allows `ecs_sg_id` only.
- [x] **TLS enforced on RDS & Redis:** `rds.force_ssl = 1`, `transit_encryption_enabled = true`, `at_rest_encryption_enabled = true`.
- [x] **No `0.0.0.0/0` DB/Redis/SSH ingress:** Verified in `modules/security_groups/main.tf`.
- [x] **No wildcard IAM permissions:** `api_task` and `worker_task` scoped to explicit Secrets Manager, KMS, and S3 ARNs.
- [x] **Private S3 buckets + KMS encryption:** `block_public_acls`, `block_public_policy`, `ignore_public_acls`, `restrict_public_buckets = true`.
- [x] **KMS key rotation enabled:** `enable_key_rotation = true`.
- [x] **No embedded secrets in Terraform, Dockerfiles, or GitHub Actions:** Verified by static scan.
- [x] **GitHub OIDC federation (no static AWS access keys):** Configured in `modules/iam/main.tf` and `.github/workflows/staging-deploy.yml`.
