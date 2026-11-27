# Operza Growth — Customer Portal 2.0 Implementation Plan

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `3fc662d`

1. **Database Migration (`packages/db/migrations/049_customer_portal_2_0.sql`):**
   - `customer_portal_configs`, `customer_portal_magic_links`, `customer_portal_sessions`, `customer_portal_requests`, and `customer_portal_events` with composite `(agency_id, location_id, id)` PKs, `FORCE ROW LEVEL SECURITY`, and `operza_app` / `operza_worker` grants.
2. **Core Portal 2.0 Engine (`packages/platform-core/src/customer-portal-2-0.mjs`):**
   - Cryptographic magic-link token generation & SHA-256 hashing (`generateMagicLinkToken`, `hashPortalToken`), single-use + expiry + agency/contact binding verification, and anti-enumeration request handling.
   - Agency-scoped customer session verification (`verifyPortalSession`), strict role separation (`role: 'external_customer'`, never agency admin).
   - Field-level profile update allowlist (`sanitizeCustomerProfilePatch`), internal-note stripping (`filterCustomerVisibleMessages`), self-service request state machine (`requested` -> `approved` | `rejected` -> `completed`), and IDOR ownership guard (`assertCustomerOwnsRecord`).
3. **Repository & Modular API (`packages/db/lib/customer-portal-2-repository.mjs`, `apps/api/routes/portal2.mjs`):**
   - `TenantTx`-scoped portal config, magic-link issue/consume, session revoke, customer-scoped overview/profile/appointments/conversations/orders/invoices/preferences, and self-service request lifecycle, mounted in `apps/api/routes/phase7.mjs` under `/api/portal/v2/*`.
4. **Agency Admin & Customer Portal 2.0 UI (`apps/web/src/components/PortalHub2Panel.tsx`):**
   - Mounted in `apps/web/src/pages/ClientPortal.tsx` for agency admins to configure portal branding, allowed features, custom domain status, and review self-service requests, alongside a live Customer Self-Service Preview.
5. **Testing & Documentation:**
   - `packages/platform-core/test/customer-portal-2-0.test.mjs`, full regression (`@operza/api`, `@operza/db`, `verify-ci-postgres.mjs`, `@operza/web` `typecheck` + `build`, `test-e2e.mjs`, `run-seo-checks.mjs`), and all 10 docs in `docs/PRODUCT_ADVANCEMENT/CUSTOMER_PORTAL_2/`.
