# Authorization & Tenant Isolation Revalidation

Revalidated in Stage 19 using `stage19_rc1_verify.mjs` (direct HTTP + `route-authz.mjs` + isolated PostgreSQL) alongside Stage 18 `stage-18-hardening.test.mjs` and `rls_audit.mjs`.

## 1. Role Permission Matrix (Verified via `route-authz.mjs`)

| Role | `contacts:read` | `contacts:write` | `refunds:approve` | `canActorViewFinancials` | `isPlatformAdminActor` |
| --- | --- | --- | --- | --- | --- |
| `owner` | `true` | `true` | `true` | `true` | `false` |
| `admin` | `true` | `true` | `true` | `true` | `false` |
| `location_manager` | `true` | `true` | `false` | `false` | `false` |
| `sales_agent` | `true` | `true` | `false` | `false` | `false` |
| `support_agent` | `true` | `false` | `false` | `false` | `false` |
| `marketing_specialist` | `true` | `false` | `false` | `false` | `false` |
| `analyst` | `true` | `false` | `false` | `true` | `false` |
| `read_only` | `true` | `false` | `false` | `false` | `false` |

- **Unauthenticated `GET /api/reports/v2/overview`:** Returns `401`.
- **Unauthenticated `GET /metrics`:** `database.totalUsers === undefined` (tenant counts withheld).
- **Inactive/Deactivated Users & Agencies:** Verified in `@operza/api` `auth-postgresql-authority.test.mjs` (18 scenarios: revoked user `401 USER_INACTIVE`, missing/revoked membership `403 NO_ACTIVE_MEMBERSHIP`, suspended agency `403 AGENCY_INACTIVE`).
- **Location Boundaries:** `getActor` in `apps/api/server.mjs` filters `actor.locations` by `user_location_memberships` when memberships exist; unauthorized `x-operza-location` header is rejected (`403`).

## 2. PostgreSQL RLS Verification (`operza_app` & `operza_worker`)

- **Tables Inspected:** `134` public tables (`126` tenant-owned `agency_id` tables, `8` non-tenant tables).
- **RLS + FORCE RLS + Policy Coverage:** `126/126` (100%) on both fresh (`001`–`053`) and upgrade (`001`–`052` → `053`) runs.
- **Role Privileges:** `operza_app` (`rolbypassrls=false`, `rolsuper=false`) and `operza_worker` (`rolbypassrls=false`, `rolsuper=false`).
- **Cross-Tenant Isolation (Stage 19 `stage19_rc1_verify.mjs`):**
  - `operza_app` under Agency B querying `location_records` seeded for Agency A: **`0` rows leaked**.
  - `operza_worker` under Agency B querying `locations WHERE agency_id = <agencyA>`: **`0` rows leaked**.
