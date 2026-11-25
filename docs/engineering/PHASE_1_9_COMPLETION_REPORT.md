# Phase 1.9 Completion Report — Forms, Tasks, Reviews, Auth/Agency & Monolith Retirement

**Date:** 2026-11-25
**Branch:** `feat/operza-agency-launch-readiness`
**Baseline Commit:** `76a989824decfacb813dc149ee0014772c9f4cbd`

---

## 1. Summary of Changes

1. **Additive Migration (`packages/db/migrations/035_forms_tasks_reviews.sql`)**:
   - Created `forms`, `form_submissions`, `tasks`, `reviews`, and `review_requests` tables with composite `(agency_id, location_id, id)` primary keys, `FORCE ROW LEVEL SECURITY`, valid status/rating/channel constraints, `form_submissions` idempotency unique index, and least-privilege `operza_app` / `operza_worker` grants.

2. **Tenant-Scoped Repositories (`packages/db/lib/`)**:
   - `forms-repository.mjs` (`createFormsRepository`): form CRUD, publish/archive, idempotent `recordSubmission`, `listSubmissions`.
   - `tasks-repository.mjs` (`createTasksRepository`): task CRUD, filtering, sort allowlist, status transitions (`completedAt` lifecycle).
   - `reviews-repository.mjs` (`createReviewsRepository`): review creation/moderation, `createReviewRequest`.
   - Exported all three in `packages/db/lib/database.mjs`.

3. **Modular Routers (`apps/api/routes/`)**:
   - `forms.mjs` (`handleFormsRoutes`): `/api/crm/forms*`, `/api/forms/:id/publish`, `/api/forms/submissions`, `/api/forms/:id/submissions`, `/api/forms/public/:slug`, `/api/forms/submit/:slug` (honeypot defense, payload size & field validation, server-side tenant resolution from published form, contact/opportunity provisioning, workflow trigger).
   - `tasks.mjs` (`handleTasksRoutes`): `/api/crm/tasks*`, `/api/tasks*` (API key scopes, tenant ID stripping, status transitions).
   - `reviews.mjs` (`handleReviewsRoutes`): `/api/crm/reviews*`, `/api/reviews/:id/reply`, `/api/reviews/request`, `/api/reviews/requests*`, `/api/reviews/public/:locationId`, `/api/reviews/submit/:locationId` (pre-dispatch consent check on review requests blocking with `403 ConsentRevoked`, promoter/detractor tagging, detractor follow-up task creation).

4. **Auth & Agency Security Hardening**:
   - Audited `apps/api/routes/auth.mjs` & `apps/api/lib/google-auth.mjs`: `scrypt` + `safeEqual`, RS256 JWKS Google OAuth verification, hashed single-use OTP with rate limiting & lockout, server-side `auth_sessions` revocation on logout, and `TRUST_PROXY`-gated IP extraction. Verified via all 22 tests in `apps/api/test/sprint-0-security-remediation.test.mjs`.
   - Hardened `apps/api/routes/agency.mjs`: enforced `owner`/`admin` role checks on team invite, role updates, and member removal, and blocked owner modification by non-owners and self-role escalation.

5. **Monolith Retirement (`apps/api/server.mjs` & `docs/engineering/MONOLITH_RETIREMENT_INVENTORY.md`)**:
   - Retired inline public/authenticated Forms and Reviews handlers from `server.mjs` in favor of `handleFormsRoutes` and `handleReviewsRoutes`.
   - Wired `handleTasksRoutes` for `/api/tasks*` and `/api/crm/tasks*`.
   - Eliminated ~640 lines of shadowed/duplicate inline `/api/agency/*` handlers (`team`, `locations`, `snapshots`, `branding`) that remained after `handleAgencyRoutes`.
   - Retained only shared HTTP bootstrap, CORS/CSRF/rate-limit middleware, webhook ingress, and platform/AI/Zapier/portal subsystems in `server.mjs`.

---

## 2. Verification Matrix

| Check | Result | Notes |
| --- | --- | --- |
| `node --check` (all modified/new `.mjs`) | PASS (`exit 0`) | Clean syntax |
| `node --test packages/db/test/forms-tasks-reviews-repositories.test.mjs apps/api/test/forms-tasks-reviews-api.test.mjs apps/api/test/sprint-0-security-remediation.test.mjs` | PASS (`29/29`, `exit 0`) | Forms/Tasks/Reviews/Agency + Auth/CSRF/OTP/OAuth security |
| `node scripts/verify-ci-postgres.mjs` | PASS (`130/130`, `exit 0`) | 35 migrations applied under `operza_migrator`; real PG RLS verified for Forms, Tasks, Reviews |
| `node scripts/test-e2e.mjs` | PASS (`116/116`, `exit 0`) | Full system E2E suite |
| `npm --workspace=@operza/web run typecheck` | PASS (`exit 0`) | Clean TypeScript check |
| `npm --workspace=@operza/web run build` | PASS (`exit 0`) | 211 modules transformed, prerendered |
| `node scripts/seo-audit/run-seo-checks.mjs` | PASS (`106/106`, `exit 0`) | 100% compliance |
| `git diff --check` | PASS (`exit 0`) | Clean whitespace/EOF check |
