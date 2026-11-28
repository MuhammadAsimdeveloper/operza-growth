# Infrastructure Security Scan

- **Automated Static Scan (`node scripts/validate-staging-infra.mjs`):** **PASS (0 findings)** across 15 `.tf` files, 4 `.github/workflows/*.yml` files, and `docker-compose.staging.yml`:
  - `publicly_accessible = false` on RDS (`modules/database/main.tf`)
  - `transit_encryption_enabled = true` & `at_rest_encryption_enabled = true` on Redis (`modules/redis/main.tf`)
  - `block_public_acls = true` & SSE-KMS on S3 (`modules/storage/main.tf`)
  - `enable_key_rotation = true` on KMS (`modules/secrets_kms/main.tf`)
  - Zero `*` wildcard IAM statements (`modules/iam/main.tf`)
  - Zero `0.0.0.0/0` rules on RDS/Redis/SSH (`modules/security_groups/main.tf`)
  - Zero embedded secrets in `.tf`, `.yml`, or `Dockerfile`s.
- **External Scanners (`checkov`, `tfsec`, `tflint`):** **Not installed** on local host; must be run in CI or operator workstation before `terraform apply`.
