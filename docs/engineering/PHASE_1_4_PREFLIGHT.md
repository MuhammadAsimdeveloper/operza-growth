# Phase 1.4 Pre-Flight Audit & Next Phase Scope
## Scheduling Domain Extraction, Calendar & Appointment Persistence Boundary

**Repository:** `C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Verified Baseline HEAD:** `ef815a1` (`refactor(opportunities): modularize opportunities domain and establish tenant-scoped repository`)  
**Status:** Pre-flight Audited & Phase 1.4 Formally Approved  
**Date:** 2026-11-23  

---

## 1. Verified Repository Baseline

### 1.1 Command Outputs
- `git status --short --branch`: `## feat/operza-agency-launch-readiness...origin/feat/operza-agency-launch-readiness [ahead 1]` (Clean working tree).
- `git rev-parse HEAD`: `ef815a1`
- `git branch --show-current`: `feat/operza-agency-launch-readiness`
- `git log -4 --oneline --decorate`:
  - `ef815a1 refactor(opportunities): modularize opportunities domain and establish tenant-scoped repository`
  - `becfdf2 docs: add phase 1-2 completion report`
  - `0a8d1cd feat(crm): modularize contacts routes and update preflight docs`
  - `4ab9ac3 refactor(api): establish tenant-scoped modular domain boundary`

### 1.2 Previous Milestone Verification Matrix
| Phase | Domain / Focus | Status | Verification Evidence |
|---|---|:---:|---|
| **Phase 0** | Honest Architecture Certification & Security Baseline | **VERIFIED** | Certified in `PHASE_0_COMPLETION_REPORT.md` (commit `70281af`). Webhooks, vault secrets, disk media, carrier compliance. |
| **Phase 1.1** | TenantTx Foundation & Contacts Boundary | **VERIFIED** | `packages/db/test/tenant-tx.test.mjs` (11/11 passed). Transaction boundary enforces non-privileged role and `SET LOCAL`. |
| **Phase 1.2** | Contacts Domain Extraction | **VERIFIED** | `packages/db/test/contacts-repository.test.mjs` (5 suites passed), `apps/api/test/contacts-api.test.mjs`, real PostgreSQL merge test in `real-postgres-integration.test.mjs`. |
| **Phase 1.3** | Opportunities Domain Extraction | **VERIFIED** | `packages/db/test/opportunities-repository.test.mjs` (4 suites passed), `apps/api/test/opportunities-api.test.mjs`, zero dual-writing, pipeline stage transitions. |

---

## 2. Phase 1.4 Objectives & Architecture Design

### 2.1 Stated Objectives
1. **Extract Scheduling Domain Repository:** Implement `packages/db/lib/scheduling-repository.mjs` with full CRUD operations for `calendars` and `appointments` through `TenantTx`, strictly enforcing PostgreSQL Row Level Security (RLS).
2. **Extract Scheduling Domain Router:** Implement `apps/api/routes/scheduling.mjs` encapsulating all calendar and appointment routing:
   - Private CRM CRUD: `GET/POST/PUT/DELETE /api/crm/calendars*` and `GET/POST/PUT/DELETE /api/crm/appointments*`.
   - Public Booking Ingress: `GET /api/calendars/public/:idOrSlug` and `POST /api/calendars/book/:idOrSlug`.
   - 2-Way Calendar Sync & OAuth: `/api/calendars/:id/oauth/start`, `/api/calendars/oauth/callback`, `/api/calendars/:id/sync/*`.
3. **GiST Concurrency & Double-Booking Prevention:**
   - Enforce database-level GiST exclusion constraint (`exclude_overlapping_active_appointments` from Migration 015) using PostgreSQL `tstzrange(starts_at, ends_at, '[)')`.
   - Map PostgreSQL error code `23P01` directly to HTTP 409 `SLOT_CONFLICT`.
   - Ensure `cancelled` appointments instantly release the time slot via the partial index predicate `WHERE (status != 'cancelled')`.
   - Ensure adjacent appointments (e.g. `10:00-10:30` and `10:30-11:00`) do not conflict on half-open interval boundaries.
4. **Authoritative Persistence (Zero Dual-Truth):**
   - When `pgPool` is configured, PostgreSQL is the sole authoritative store. No writes to `state.records.calendars` or `state.records.appointments`.
   - In-memory fallback is isolated exclusively for zero-config offline test runs (`!pgPool`).
5. **Wire & Frontend Compatibility:**
   - 100% compatibility with frontend callers in `apps/web/src/lib/api.ts` and `apps/web/src/pages/Calendars.tsx`.

---

## 3. Database Schema Mapping (Migration 011, 015, 021, 025)

### `calendars` table:
- `id uuid NOT NULL`
- `agency_id uuid NOT NULL`
- `location_id uuid NOT NULL`
- `name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120)`
- `slug text NOT NULL`
- `color text DEFAULT '#4f46e5'`
- `duration_min integer NOT NULL DEFAULT 30`
- `availability jsonb NOT NULL DEFAULT '{}'::jsonb`
- `round_robin boolean NOT NULL DEFAULT false`
- `description text`
- `status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- Primary Key: `(agency_id, location_id, id)`
- Foreign Key: `(agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE`
- RLS Policies: `calendars_app_scope` (agency_id and location_id matched to session settings).

### `appointments` table:
- `id uuid NOT NULL`
- `agency_id uuid NOT NULL`
- `location_id uuid NOT NULL`
- `calendar_id uuid NOT NULL`
- `contact_id uuid`
- `title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200)`
- `starts_at timestamptz NOT NULL`
- `ends_at timestamptz NOT NULL`
- `status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show'))`
- `assigned_to uuid REFERENCES users(id) ON DELETE SET NULL`
- `notes text`
- `external_event_id text`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- Primary Key: `(agency_id, location_id, id)`
- Constraints:
  - `chk_appointments_time_range`: `CHECK (ends_at > starts_at)`
  - `exclude_overlapping_active_appointments`: `EXCLUDE USING gist (agency_id WITH =, location_id WITH =, calendar_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status != 'cancelled')`
- RLS Policies: `appointments_tenant_scope` / `appointments_app_scope`.

---

## 4. TDD Execution Plan

1. **RED:**
   - Create `packages/db/test/scheduling-repository.test.mjs` testing calendar CRUD, appointment CRUD, cross-tenant isolation, GiST double booking rejection, adjacent booking acceptance, cancellation slot release, and rescheduling conflict.
   - Create `apps/api/test/scheduling-api.test.mjs` testing HTTP endpoints: `/api/crm/calendars`, `/api/crm/appointments`, `/api/calendars/public/:idOrSlug`, `/api/calendars/book/:idOrSlug`, scope checking, ID injection stripping, slot conflict 409 responses.
   - Run tests to prove RED failure.
2. **GREEN:**
   - Create `packages/db/lib/scheduling-repository.mjs`.
   - Export `createSchedulingRepository` from `packages/db/lib/database.mjs`.
   - Create `apps/api/routes/scheduling.mjs`.
   - Wire router into `apps/api/routes/crm.mjs` and `apps/api/server.mjs`.
   - Run tests to confirm GREEN passing.
3. **REFACTOR:**
   - Remove legacy scheduling route blocks in `server.mjs`.
4. **VERIFY:**
   - Run full 10-stage verification suite.
5. **DOCUMENT & COMMIT:**
   - Write completion report and commit.
