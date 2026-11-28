# Tenant Isolation and PostgreSQL RLS Audit — Stage 18

## 1. Live `pg_class` & `pg_roles` Inspection

Executed against an isolated PostgreSQL instance across all 53 migrations (`001` through `053`):
- **Total `public` tables:** `134`
- **Agency-owned tables (`agency_id` column) with `RLS + FORCE RLS + >=1 policy`:** **100%** (repaired the 4 remaining tables in Migration `053`: `auth_sessions`, `commerce_webhook_events`, `marketplace_analytics_events`, `public_form_registry`).
- **Database Roles:**
  - `operza_app`: `rolbypassrls = false`, `rolsuper = false`
  - `operza_worker`: `rolbypassrls = false`, `rolsuper = false`
  - `postgres` (migration owner): `rolbypassrls = true`, `rolsuper = true`

## 2. Migration 053 Repairs

`packages/db/migrations/053_platform_hardening_rls_and_indexes.sql` added:
- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + tenant isolation policies on `auth_sessions`, `commerce_webhook_events`, `marketplace_analytics_events`, and `public_form_registry`.
- Note: `auth_sessions` policy uses `agency_id::text = NULLIF(current_setting('app.agency_id', true), '') OR user_id::text = NULLIF(current_setting('app.user_id', true), '')` so non-UUID `actorId` values (such as `'system'`) never trigger `22P02 invalid input syntax for type uuid` while still blocking cross-tenant reads under `operza_app`.

## 3. Location-Boundary Enforcement

- `apps/api/server.mjs` (`getActor`) now queries `user_location_memberships` for `(row.agency_id, row.user_id)`. When location assignments exist, `locations` is filtered strictly to assigned `location_id`s and `x-operza-location` requests outside that set are rejected (`null` -> `401`).
- `packages/db/lib/tenant-tx.mjs` binds `app.agency_id`, `app.location_id`, and `app.user_id` via `SET LOCAL` inside every transaction, preventing connection-pool context leakage.
