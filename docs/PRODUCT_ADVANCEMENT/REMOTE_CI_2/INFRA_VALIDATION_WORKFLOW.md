# Infrastructure Validation Workflow (`.github/workflows/infra-validation.yml`)

- **Triggers:** `workflow_dispatch`, plus `push` and `pull_request` on `infra/**`, `apps/**/Dockerfile`, `docker-compose*.yml`, `packages/db/**`, `.env.staging.example`, `.github/workflows/infra-validation.yml`.
- **Permissions:** `contents: read` only (no `id-token: write`, no `environment:`, no AWS credentials).
- **Concurrency:** `group: ${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: true`.
- **Gates:** A (Source Quality) -> B (Terraform CLI) & D (Docker/Compose) & G (Regression); B -> C (tfsec); D -> E & F (PG/Redis/ClamAV/API/Worker); all -> H (`$GITHUB_STEP_SUMMARY`).
