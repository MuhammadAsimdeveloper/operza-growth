# Operza Growth — Phase 1.3 Completion Report
## Opportunities Domain Extraction, Pipeline Stage State Machine & TenantTx Persistence Boundary

**Repository:** `C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `becfdf2` (`docs: add phase 1-2 completion report`)  
**Status:** COMPLETE & CERTIFIED  
**Date:** 2026-11-23  

---

## 1. Executive Summary

Phase 1.3 of the Operza Growth foundation re-platform has extracted the Opportunities domain into a dedicated, typed repository (`OpportunitiesRepository`) operating under strict `TenantTx` transaction boundaries, backed by PostgreSQL Row Level Security (RLS) on the dedicated `opportunities` table (Migration 011).

In addition, Phase 1.3 has certified the conditional pass requirement from Phase 1.2 by implementing real PostgreSQL relational merge and rollback tests in `packages/db/test/real-postgres-integration.test.mjs`, proving that foreign key re-linking from `opportunities` to `contacts` and atomic rollback work under least-privilege `operza_app` execution with `FORCE ROW LEVEL SECURITY`.

---

## 2. Architecture & Deliverables

### 2.1 Repository Boundary (`packages/db/lib/opportunities-repository.mjs`)
- `create(tx, data)`: Strips client-supplied tenant IDs, forces active `agencyId` and `locationId`, inserts into `opportunities`, and returns normalized entity.
- `getById(tx, id)`: Queries `opportunities` strictly within tenant context.
- `list(tx, options)`: Supports searching by name/source (`ILIKE`), filtering by `pipelineId`, `stageId`, `status`, `contactId`, pagination (`page`, `limit`), and sort allowlist protection (`ALLOWED_SORT_FIELDS`).
- `update(tx, id, updates)`: Validates tenant ownership, updates allowed fields, and updates `updated_at`.
- `updateStage(tx, id, { pipelineId, stageId, status })`: Specialized helper for Kanban pipeline stage moves.
- `delete(tx, id)`: Deletes opportunity strictly within tenant boundary.
- `getPipelineSummary(tx, pipelineId)`: Aggregates opportunity count and total value grouped by `stage_id` and `status`.

### 2.2 Domain Router (`apps/api/routes/opportunities.mjs`)
- Dispatches all `/api/crm/opportunities*` and `/api/opportunities*` routes:
  - `GET /api/crm/opportunities` & `GET /api/opportunities` (list with filters, sorting, pagination)
  - `POST /api/crm/opportunities` & `POST /api/opportunities` (create opportunity, triggers workflow and zapier events)
  - `GET /api/crm/opportunities/pipeline-summary` & `GET /api/opportunities/pipeline-summary` (stage aggregate totals)
  - `GET /api/crm/opportunities/:id` & `GET /api/opportunities/:id` (single record retrieval)
  - `PUT /api/crm/opportunities/:id` & `PUT /api/opportunities/:id` (update opportunity, triggers stage change events)
  - `DELETE /api/crm/opportunities/:id` & `DELETE /api/opportunities/:id` (deletion)
- Zero dual-writing: When `pgPool` is active, PostgreSQL is the authoritative single source of truth; no writes or reads from `state.records.opportunities`.

### 2.3 Router Wiring & Integration
- `apps/api/routes/crm.mjs`: Added delegation to `handleOpportunitiesRoutes`.
- `apps/api/server.mjs`: Added import and direct handler dispatch for `/api/opportunities*`.
- `packages/db/lib/database.mjs`: Exported `createOpportunitiesRepository`.

### 2.4 Real PostgreSQL Relational Merge Certification
- In `packages/db/test/real-postgres-integration.test.mjs`, added test section 7 verifying:
  - Two contacts in `location_records` and an opportunity in `opportunities` linked to secondary contact.
  - Execution of `ContactsRepository.merge` on real PostgreSQL under `operza_app` role.
  - Verifies that opportunity `contact_id` is updated to primary contact.
  - Verifies that secondary contact is deleted.
  - Verifies that an invalid secondary ID triggers `CONTACT_NOT_FOUND` and rolls back transaction cleanly.

---

## 3. Verification Matrix

| Check / Test Suite | Command | Result | Exit Code | Details |
|---|---|:---:|:---:|---|
| **TenantTx Contract** | `node --test packages/db/test/tenant-tx.test.mjs` | **PASS** | 0 | 11/11 tests passed |
| **Contacts Repository** | `node --test packages/db/test/contacts-repository.test.mjs` | **PASS** | 0 | 5/5 suites passed |
| **Opportunities Repository** | `node --test packages/db/test/opportunities-repository.test.mjs` | **PASS** | 0 | 4/4 suites passed |
| **Contacts API Contract** | `node --test apps/api/test/contacts-api.test.mjs` | **PASS** | 0 | 1/1 suite (7 sub-scenarios) passed |
| **Opportunities API Contract** | `node --test apps/api/test/opportunities-api.test.mjs` | **PASS** | 0 | 1/1 suite (4 sub-scenarios) passed |
| **System E2E Verification** | `node scripts/test-e2e.mjs` | **PASS** | 0 | 116/116 tests passed |
| **Frontend Production Build** | `npm --workspace=@operza/web run build` | **PASS** | 0 | Clean TypeScript compilation, 12 static routes prerendered |
| **SEO & Public Directives Audit** | `node scripts/seo-audit/run-seo-checks.mjs` | **PASS** | 0 | 106/106 checks passed |
| **Git Whitespace Audit** | `git diff --check` | **PASS** | 0 | Clean, 0 whitespace issues |

---

## 4. Next Milestone

Based on `02_MASTER_PLAN.md` and `docs/engineering/API_ARCHITECTURE_MAP.md`, the next phase is:
**Phase 1.4 — Scheduling Domain Extraction (Calendars & Appointments) & TenantTx Boundary**
- Extract Calendars and Appointments from `apps/api/server.mjs` into `apps/api/routes/scheduling.mjs`.
- Build `SchedulingRepository` enforcing GiST exclusion constraints (`appointments` table) under `TenantTx`.
