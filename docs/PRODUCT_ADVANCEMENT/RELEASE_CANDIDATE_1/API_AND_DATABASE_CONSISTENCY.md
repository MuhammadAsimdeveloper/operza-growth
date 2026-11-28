# API & Database Consistency Review

## 1. API Contract Findings

- **31 route modules** exist under `apps/api/routes/` alongside core dispatch in `apps/api/server.mjs`.
- **Coexisting v1 & v2 Route Prefixes (Technical Debt):**
  - v1 routes use `/api/crm/*`, `/api/payments/*`, `/api/workflows/*`, `/api/agency/*`.
  - v2 routes use `/api/<module>/v2/*` (e.g., `/api/reports/v2/*`, `/api/support/v2/*`, `/api/commerce/v2/*`, `/api/portal/v2/*`, `/api/sites/v2/*`, `/api/engagement/v2/*`, `/api/workflows/v2/*`, `/api/ai/v2/*`, `/api/agency/v2/*`), while CRM v2 uses `/api/crm/contacts/:id/profile` and `/api/crm/v2/*`.
  - **Impact:** Functional, because frontend components target the exact prefixes, but external API consumers must know which prefix belongs to v1 vs v2.
- **Authorization Consistency:** Consolidated onto `packages/platform-core/src/security/route-authz.mjs` in Stage 18; `crm2.mjs` CSV import signature mismatch was fixed.
- **Error Responses & Fail-Closed Behavior:** PostgreSQL-only v2 modules (`portal2.mjs`, `crm2.mjs` Customer 360) return `503` when PostgreSQL is unconfigured; unimplemented connectors return `501`; CSRF mismatches return `403`.
- **Currency Representation:** Analytics Metric Catalog V2 and Commerce 2.0 store/separate currencies in minor units (cents) per currency code.

## 2. Database & Migration Consistency (`001`–`053`)

- **Total Migrations:** 53 sequential SQL files (`001` through `053_platform_hardening_rls_and_indexes.sql`).
- **Fresh Install (`001`–`053`):** Verified clean (`0` SQL errors).
- **Upgrade Path (`001`–`052` → `053`):** Verified clean (`0` SQL errors, idempotent `IF NOT EXISTS` / `DROP POLICY IF EXISTS`).
- **RLS & Grants:** `126/126` `agency_id` tables have `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and valid policies; `134/134` tables have runtime grants for `operza_app` and `operza_worker`.
- **Schema Integrity:** Foreign keys, unique constraints (e.g. action receipts, outbox idempotency keys, appointment slot exclusivity), and composite tenant indexes (`idx_auth_sessions_agency_user`, `idx_user_location_memberships_agency_user`, `idx_commerce_refunds_agency_loc_payment`) are in place.
