# Terraform CLI Validation

- **Terraform CLI (`terraform version`, `fmt -check`, `init -backend=false`, `validate`):** **NOT EXECUTED** (`terraform` binary is not installed on this Windows host).
- **Supplementary Static Check (`node scripts/validate-staging-infra.mjs`):** **PASS** across all **15** `.tf` files (balanced braces, no `ACCOUNT_ID` literal, no `*` IAM wildcards, no embedded secrets, private RDS/Redis/S3 defaults).
- **Stage 22 Fix:** Replaced `ACCOUNT_ID` in `infra/terraform/modules/iam/main.tf` with `data.aws_caller_identity.current.account_id`.
- **Operator Requirement:** Run `terraform fmt -check -recursive && terraform init -backend=false && terraform validate` in CI or an operator workstation with Terraform `>= 1.6.0`.
