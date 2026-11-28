# Database and Performance Audit — Stage 18

## 1. Tenant-Aware Query & Index Improvements

`packages/db/migrations/053_platform_hardening_rls_and_indexes.sql` added composite indexes for hot governance and commerce lookups:
- `idx_auth_sessions_agency_user` on `auth_sessions (agency_id, user_id)` — accelerates `listActiveSessions` and offboarding revocation.
- `idx_user_location_memberships_agency_user` on `user_location_memberships (agency_id, user_id)` — accelerates `getActor` location-scope resolution on every authenticated request.
- `idx_commerce_refunds_agency_loc_payment` on `commerce_refunds (agency_id, location_id, payment_id)` — accelerates `requestRefund` sum-check inside `FOR UPDATE` transactions.

## 2. Caching & Safety

- No shared cross-tenant response caching is enabled on tenant-scoped API endpoints, eliminating cross-agency/cross-location cache leakage risks.
- Local benchmark timings (`p50=3.77ms`, `p95=4.79ms` for `TenantTx getExecutiveOverview` over 100 contacts) are documented in `PERFORMANCE_TEST_RESULTS.md` and are not claimed as production SLAs.
