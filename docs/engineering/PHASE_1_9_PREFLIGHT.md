# Phase 1.9 Preflight — Forms, Tasks, Reviews, Auth/Agency & Monolith Retirement

**Date:** 2026-11-25
**Repository:** `MuhammadAsimdeveloper/operza-growth` (`C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`)
**Branch:** `feat/operza-agency-launch-readiness`
**Baseline HEAD:** `76a989824decfacb813dc149ee0014772c9f4cbd` (`refactor(messaging): extract conversations and communication consent domains`)
**Working Tree:** Clean, `[ahead 6]` relative to `origin/feat/operza-agency-launch-readiness`

---

## 1. Phase 1.8 Verification Summary
- `ConversationsRepository` (`packages/db/lib/conversations-repository.mjs`) and `CommunicationConsentsRepository` (`packages/db/lib/communication-consents-repository.mjs`) verified with `FORCE ROW LEVEL SECURITY` across `communication_consents` (Migration 008) and `conversations`/`messages` (Migration 034).
- `POST /api/webhooks/twilio` verified: validates `x-twilio-signature` (HMAC-SHA1), fails closed in production (`WEBHOOK_SECRET_REQUIRED`), checks `isWebhookReplay`, and records `STOP`/`UNSUBSCRIBE` opt-outs via `recordInboundOptOut`.
- `POST /api/conversations/:id/messages` enforces pre-dispatch consent check (`403 ConsentRevoked`) and preserves honest `queued` status.

---

## 2. Auth & Agency Security Audit Findings
- **Auth (`apps/api/routes/auth.mjs`, `apps/api/lib/google-auth.mjs`)**:
  - Password hashing: `scrypt` with 16-byte salt and timing-safe `safeEqual`.
  - Google OAuth: cryptographic RS256 JWKS verification, issuer/audience/exp/`email_verified` checks, and account-takeover prevention.
  - Magic-link/OTP: `randomInt` 6-digit code, salted hash, 10-min TTL, max 3 attempts, 15s cooldown, single-use deletion, no response leakage.
  - Logout: revokes server-side session from `state.sessions` and `auth_sessions`, clears cookies.
  - Rate limiting & proxy trust: `TRUST_PROXY` + loopback/private-range check in `server.mjs`.
- **Agency (`apps/api/routes/agency.mjs` + `apps/api/server.mjs`)**:
  - **Gap Identified**: `POST /api/agency/team/invite`, `PUT /api/agency/team/:id/role`, and `DELETE /api/agency/team/:id` in `apps/api/routes/agency.mjs` lack `owner`/`admin` role enforcement, and `PUT /api/agency/team/:id/role` does not prevent self-escalation or modifying an owner.
  - **Monolith Duplication Identified**: `apps/api/server.mjs` (lines 7958–9150) retains shadowed/dead inline `/api/agency/*` handlers after `handleAgencyRoutes`.

---

## 3. Phase 1.9 Scope & Implementation Sequence
1. **Additive Migration `035_forms_tasks_reviews.sql`**:
   - Create `forms`, `form_submissions`, `tasks`, `reviews`, and `review_requests` tables with composite `(agency_id, location_id, id)` primary keys, `FORCE ROW LEVEL SECURITY`, valid status/rating constraints, and `operza_app`/`operza_worker` grants.
2. **Domain Repositories (`packages/db/lib/`)**:
   - `forms-repository.mjs` (`createFormsRepository`)
   - `tasks-repository.mjs` (`createTasksRepository`)
   - `reviews-repository.mjs` (`createReviewsRepository`)
   - Export all three in `packages/db/lib/database.mjs`.
3. **Domain Routers (`apps/api/routes/`)**:
   - `forms.mjs` (`handleFormsRoutes`): `/api/crm/forms*`, `/api/forms/:id/publish`, `/api/forms/submissions`, `/api/forms/:id/submissions`, `/api/forms/public/:slug`, `/api/forms/submit/:slug` (with honeypot, payload size/field validation, server-side tenant resolution from published form, contact upsert, workflow trigger).
   - `tasks.mjs` (`handleTasksRoutes`): `/api/crm/tasks*`, `/api/tasks*` (CRUD, status transitions, priority/assignee/contact/opportunity associations, filtering, pagination, sort allowlist).
   - `reviews.mjs` (`handleReviewsRoutes`): `/api/crm/reviews*`, `/api/reviews/requests*`, `/api/reviews/public/:locationId`, `/api/reviews/submit/:locationId` (with consent check on review request dispatch, rating bounds, promoter/detractor tagging, follow-up task creation, workflow trigger).
4. **Agency & Monolith Retirement**:
   - Harden `apps/api/routes/agency.mjs` with `owner`/`admin` role authorization and self-escalation prevention.
   - Wire `handleFormsRoutes`, `handleTasksRoutes`, `handleReviewsRoutes` into `apps/api/routes/crm.mjs` and `apps/api/server.mjs`, and remove inline Forms, Reviews, and shadowed `/api/agency/*` handlers from `apps/api/server.mjs`.
5. **Verification**:
   - TDD RED->GREEN unit & API security tests, real PostgreSQL RLS integration tests (`verify-ci-postgres.mjs`), `test-e2e.mjs` (116/116), web `typecheck` & `build`, `run-seo-checks.mjs` (106/106), and `git diff --check`.
