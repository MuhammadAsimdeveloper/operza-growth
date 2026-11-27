# Operza Growth — Product Advancement Stage 12: Customer Portal & Self-Service 2.0 Completion Report

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `3fc662d`

---

## 1. Status Classification Breakdown

### Implemented & Unit / PostgreSQL / E2E Verified
- **Database Schema & `FORCE RLS` (`packages/db/migrations/049_customer_portal_2_0.sql`):**
  - Created `customer_portal_configs`, `customer_portal_magic_links` (`UNIQUE (token_hash)`), `customer_portal_sessions` (`UNIQUE (session_token_hash)`), `customer_portal_requests`, and `customer_portal_events` with composite `(agency_id, location_id, id)` primary keys, `FORCE ROW LEVEL SECURITY`, and `operza_app` / `operza_worker` grants.
- **Core Portal 2.0 Identity & Security Engine (`packages/platform-core/src/customer-portal-2-0.mjs` & `test/customer-portal-2-0.test.mjs`):**
  - 32-byte CSPRNG token generation + SHA-256 hashing (`generatePortalToken`, `hashPortalToken`), single-use + expiry + agency binding verification (`verifyMagicLinkRecord`), agency-scoped session verification (`verifyPortalSessionRecord` with `role: 'external_customer'`), open-redirect defense (`validatePortalRedirect`), IDOR guard (`assertCustomerOwnsRecord`), field-level profile allowlist (`sanitizeCustomerProfilePatch`), internal-note filtering (`filterCustomerVisibleMessages`), and self-service request approval state machine (`canTransitionPortalRequest`, `isSensitiveSelfServiceRequest`).
- **Repository, Modular API & Agency Admin UI:**
  - `packages/db/lib/customer-portal-2-repository.mjs` & `apps/api/routes/portal2.mjs` (mounted in `apps/api/routes/phase7.mjs` under `/api/portal/v2/*`).
  - `apps/web/src/components/PortalHub2Panel.tsx` mounted in `apps/web/src/pages/ClientPortal.tsx` for portal configuration, self-service request review (`requested` -> `approved` / `rejected`), security boundary overview, and customer portal navigation preview.

### Deferred (Staging / External Infrastructure)
- Live custom-domain ACME TLS termination for `portal.example.com`, live ClamAV malware scanning for uploaded customer documents, and live email/SMS magic-link delivery remain deferred to owner-approved staging infrastructure.

---

## 2. Final Verification Results

| Check | Command | Result |
|---|---|---|
| `@operza/ui` | `node --test packages/ui/test/ui.test.mjs` | **1/1 passed** (`0` fail) |
| `@operza/action-governance` | `npm --workspace=@operza/action-governance test` | **6/6 passed** (`0` fail) |
| `@operza/workflow-engine` | `npm --workspace=@operza/workflow-engine test` | **79/79 passed** (`0` fail) |
| `@operza/platform-core` | `npm --workspace=@operza/platform-core test` | **206/207 passed** (`0` fail, `1` skipped live provider network gate; includes `3/3` `customer-portal-2-0.test.mjs`) |
| `@operza/api` | `npm --workspace=@operza/api test` | **189/189 passed** (`0` fail) |
| Real PostgreSQL CI (`001`–`049`) | `node scripts/verify-ci-postgres.mjs` | **49/49 migrations + 143/143 `@operza/db` + 130/130 PG integration passed** (`0` fail) |
| Web TypeScript | `npm --workspace=@operza/web run typecheck` | **Passed** (`0` errors) |
| Web Build & Prerender | `npm --workspace=@operza/web run build` | **Passed** |
| Marketing Build | `npm --workspace=apps/marketing run build` | **Passed** |
| SEO Audit | `node scripts/seo-audit/run-seo-checks.mjs` | **106/106 passed** |
| E2E System Suite | `node scripts/test-e2e.mjs` | **116/116 passed** |
| Git Hygiene | `git diff --check` | **Passed** (`exit 0`) |
