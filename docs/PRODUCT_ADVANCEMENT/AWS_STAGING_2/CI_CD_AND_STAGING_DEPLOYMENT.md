# CI/CD & Staging Deployment Pipeline

- **Workflow:** `.github/workflows/staging-deploy.yml` (`workflow_dispatch` with explicit `confirm_staging == 'STAGING'` input guard).
- **6 Gates:**
  1. **Source Quality:** `npm ci`, `npm audit --omit=dev --audit-level=high`, `typecheck`, unit tests, `validate-staging-infra.mjs`.
  2. **Database:** PostgreSQL 16 service, `migrate.mjs` (`001`–`053`), `stage-18-hardening.test.mjs` (100% FORCE RLS).
  3. **Build:** `@operza/web` build, `apps/marketing` build, Docker API image build (`push: false`).
  4. **Staging Approval:** GitHub `staging` environment manual reviewer gate.
  5. **Deployment:** AWS OIDC federation (`aws-actions/configure-aws-credentials@v4`, zero static AWS keys), guarded by `vars.AWS_DEPLOY_ENABLED == 'true'`.
  6. **Post-Deployment Smoke Tests:** `/health`, `/ready`, `/metrics` non-leak check, auth + PostgreSQL overview check.
- **Validation:** YAML syntax and all 4 workflows validated cleanly via `node scripts/validate-staging-infra.mjs`.
