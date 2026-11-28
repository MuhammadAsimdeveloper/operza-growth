# CI/CD & Release Process Audit

## 1. Existing GitHub Workflows

- `.github/workflows/ci.yml` (**Operza CI/CD Quality Gates**)
- `.github/workflows/codeql.yml` (CodeQL static security analysis)
- `.github/workflows/docker.yml` (Docker multi-stage build verification for API & Web)

## 2. CI Gate Assessment & Stage 19 Improvements

| Gate | What It Verifies | Stage 19 Finding & Action |
| --- | --- | --- |
| **Gate 1: `static-and-unit`** | `npm ci`, `typecheck`, `action-governance`, `workflow-engine`, `platform-core`, `db`, Zapier tests, `npm run build` | **Updated in Stage 19:** Added `node --test packages/ui/test/ui.test.mjs` and `npm --workspace=apps/marketing run build` so Marketing & UI regressions fail the build. |
| **Gate 2: `postgres-integration`** | PostgreSQL 16 service, `migrate.mjs`, `@operza/db` RLS tests, 4 API PG integration suites | **Updated in Stage 19:** Updated outdated `001-027` label to `001-053` and added `node --test packages/platform-core/test/stage-18-hardening.test.mjs` so 100% FORCE RLS across all 126 tenant tables is gated in CI. |
| **Gate 3: `worker-and-redis`** | Redis 7 service + `@operza/platform-core` | Verified. |
| **Gate 4: `e2e-system-integration`** | `run-seo-checks.mjs` (106 checks) + `test-e2e.mjs` (116 scenarios) | Verified. |
| **Gate 5: `container-builds`** | Multi-stage Docker builds (`apps/api/Dockerfile`, `apps/web/Dockerfile`, `push: false`) | Verified. |
| **Gate 6: `security-audit`** | `npm audit --omit=dev --audit-level=high` | Verified (`0` prod vulns). |

## 3. Release Process Rules

- All 6 CI gates + CodeQL must pass before merging to `main`/`master` or tagging an RC.
- No auto-deploy from feature branches; staging promotion requires explicit manual approval and pre-migration RDS snapshot.
