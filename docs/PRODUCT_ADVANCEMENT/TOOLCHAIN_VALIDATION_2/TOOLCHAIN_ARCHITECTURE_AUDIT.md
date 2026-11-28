# Toolchain Architecture Audit (Stage 22)

- **Starting Commit:** `fa3f87a` (Stage 21) on `feat/operza-agency-launch-readiness`
- **Stage 22 Engineering Improvements:**
  1. Replaced literal `ACCOUNT_ID` placeholder in `infra/terraform/modules/iam/main.tf` with `data "aws_caller_identity" "current" {}`.
  2. Enhanced `scripts/validate-staging-infra.mjs` to machine-check **49** `.env.staging.example` keys, enforce `NODE_ENV=staging`, `ALLOW_IN_MEMORY_QUEUE=false`, `DATABASE_SSL=true`, and reject `ACCOUNT_ID` placeholders in Terraform.
  3. Verified **both** fresh (`001`–`054`) and upgrade (`001`–`053` -> `054`) migration paths, `operza_app_state` ownership (`operza_migrator`), `operza_app` DML access, Redis `strictDistributed` fail-closed (`RATE_LIMIT_BACKEND_UNAVAILABLE`), and ClamAV fail-closed (`unavailable`).
