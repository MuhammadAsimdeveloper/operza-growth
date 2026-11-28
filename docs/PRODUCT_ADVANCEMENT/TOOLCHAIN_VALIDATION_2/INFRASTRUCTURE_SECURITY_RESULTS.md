# Infrastructure Security Results

- **Automated Static Security Validator (`node scripts/validate-staging-infra.mjs`):** **PASS (0 violations)** across 15 `.tf` files, 4 `.github/workflows/*.yml` files, `docker-compose.staging.yml`, and `.env.staging.example`.
- **Verified Controls:** Private RDS & Redis (`publicly_accessible = false`), TLS enforced (`rds.force_ssl = 1`, Redis `transit_encryption_enabled = true`), private KMS-encrypted S3, KMS rotation enabled, zero `*` IAM wildcards, zero `ACCOUNT_ID` placeholders, zero `0.0.0.0/0` DB/Redis rules, zero embedded secrets.
- **External Scanners (`checkov`, `tfsec`, `tflint`):** **Not executed** (not installed on local Windows host).
