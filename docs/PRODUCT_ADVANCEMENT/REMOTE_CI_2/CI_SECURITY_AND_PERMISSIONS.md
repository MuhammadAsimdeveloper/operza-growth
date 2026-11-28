# CI Security & Permissions

- `infra-validation.yml` sets `permissions: contents: read` only (no `id-token: write`, no `environment:`, no AWS credentials).
- Enforced by `scripts/validate-staging-infra.mjs` which fails if `infra-validation.yml` ever requests `id-token`, calls `configure-aws-credentials`, runs `terraform apply`, sets `push: true`, or references `staging-deploy.yml`.
- Completely decoupled from `.github/workflows/staging-deploy.yml`.
