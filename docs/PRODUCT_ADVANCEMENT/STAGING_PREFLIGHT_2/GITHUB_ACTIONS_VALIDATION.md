# GitHub Actions Workflow Validation

Validated all 4 workflow YAML files (`.github/workflows/ci.yml`, `codeql.yml`, `docker.yml`, `staging-deploy.yml`) via `node scripts/validate-staging-infra.mjs` (`yaml` parser).

- **`staging-deploy.yml` Security & Gate Checks:**
  - Trigger: `workflow_dispatch` only with `confirm_staging == 'STAGING'` (never deploys on push).
  - Permissions: `id-token: write`, `contents: read` (minimum OIDC permissions, zero static AWS keys).
  - Gate 1: `npm ci`, `npm audit --omit=dev --audit-level=high`, `typecheck`, unit tests, `validate-staging-infra.mjs`.
  - Gate 2: PostgreSQL 16 service, `migrate.mjs` (`001`–`054`), `stage-18-hardening.test.mjs`.
  - Gate 3: `@operza/web` build, `apps/marketing` build, Docker API build (`push: false`).
  - Gate 4: Manual `staging` environment reviewer approval.
- **Limitation:** Local YAML parsing does not replace an actual GitHub Actions runner execution.
