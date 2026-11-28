# GitHub Actions Validation

- **YAML & Structural Validation (`node scripts/validate-staging-infra.mjs`):** **PASS** across all **4** workflows (`ci.yml`, `codeql.yml`, `docker.yml`, `staging-deploy.yml`).
- **Verified Rules:**
  - `staging-deploy.yml` triggers only on `workflow_dispatch` with `confirm_staging == 'STAGING'`.
  - Uses OIDC (`id-token: write`, `contents: read`) with zero static AWS keys.
  - Requires manual `staging` environment approval (Gate 4) and `vars.AWS_DEPLOY_ENABLED == 'true'`.
- **Limitation:** Not executed on GitHub Actions runners locally (no push performed).
