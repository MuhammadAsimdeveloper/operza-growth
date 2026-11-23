# Phase 1.3 Pre-Flight Audit & Next Phase Scope
## Opportunities Domain Extraction, Pipeline Stage State Machine & TenantTx Persistence Boundary

**Repository:** `C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Verified Baseline HEAD:** `becfdf2` (`docs: add phase 1-2 completion report`)  
**Status:** Baseline Audited & Next Phase Formally Approved  
**Date:** 2026-11-23  

---

## 1. Verified Repository Baseline

### 1.1 Command Outputs
- `git status --short --branch`: `## feat/operza-agency-launch-readiness...origin/feat/operza-agency-launch-readiness` (Clean working tree, up to date with origin).
- `git rev-parse HEAD`: `becfdf2682013d3225df28a9b49ca98db7b8f0c8`
- `git branch --show-current`: `feat/operza-agency-launch-readiness`
- `git log -8 --oneline --decorate`:
  - `becfdf2 docs: add phase 1-2 completion report`
  - `0a8d1cd feat(crm): modularize contacts routes and update preflight docs`
  - `4ab9ac3 refactor(api): establish tenant-scoped modular domain boundary`
  - `70281af docs: add Phase 0 completion & honest architecture certification report`
  - `29a57af feat(phase-0): complete honest integrations, bearer api keys, media disk storage, and honest carrier compliance`
  - `cad24a0 feat(phase-0): implement honest fail-closed security, real qr codes, and checkout validation`
  - `afb61eb feat(product): complete quality, seo and ux improvements`
  - `e402711 fix(workflows): fence action receipts and safe provider recovery`

### 1.2 Previous Phase Verification Matrix
| Phase | Scope | Status | Evidence |
|---|---|:---:|---|
| **Phase 0** | Honest integrations, fail-closed webhooks, encrypted secret vault, media disk storage, QR code real generation | **VERIFIED** | Certified in `PHASE_0_COMPLETION_REPORT.md` (commit `70281af`). Webhooks, payments, integrations, and carrier compliance tested fail-closed. |
| **Phase 1.1** | `TenantTx` transaction boundary, initial `ContactsRepository` | **VERIFIED** | `packages/db/test/tenant-tx.test.mjs` (11/11 passed), `packages/db/lib/tenant-tx.mjs` enforces `SET LOCAL` and client release. |
| **Phase 1.2** | Complete Contacts domain extraction, dedicated router, atomic merge, timeline, bulk-tagging, persistence certification | **VERIFIED** | `packages/db/test/contacts-repository.test.mjs` (5/5 suites passed), `apps/api/test/contacts-api.test.mjs` (passed), `apps/api/routes/contacts.mjs` authoritative with zero dual-writing. E2E (116/116 passed). Real PostgreSQL CI runner (254/254 passed). |

---

## 2. Next Phase Selection: Phase 1.3

### 2.1 Authoritative Source
- Master Plan: `02_MASTER_PLAN.md` (§B Phase 1: Foundation re-platform, items 2, 5, 6).
- Architecture Map: `docs/engineering/API_ARCHITECTURE_MAP.md` (§6 Modular Domain Architecture Evolution: Opportunities domain target for Phase 1.3).
- Phase 1.2 Conditional Pass Condition: Certification of real PostgreSQL relational merge rollback in `real-postgres-integration.test.mjs`.

### 2.2 Stated Objectives
1. **Extract Opportunities Domain Router:** Move all `/api/crm/opportunities*` and `/api/opportunities*` handling out of `apps/api/server.mjs` generic collection routines into a dedicated `apps/api/routes/opportunities.mjs` router module.
2. **Build `OpportunitiesRepository`:** Create `packages/db/lib/opportunities-repository.mjs` leveraging `TenantTx` to interact with the PostgreSQL `opportunities` table (Migration 011).
3. **Stage State Machine & Summary:** Support pipeline and stage transitions, status updates (`open`, `won`, `lost`, `abandoned`), contact association (`contact_id`), and stage summary aggregation.
4. **Authoritative Persistence (Zero Dual-Truth):** When `pgPool` is configured, PostgreSQL is the single source of truth. No writes to `state.records.opportunities` and no stale reads. Local state blob is strictly reserved for `!pgPool` mode.
5. **Real PostgreSQL Relational Merge Rollback:** Add test to `packages/db/test/real-postgres-integration.test.mjs` verifying that `ContactsRepository.merge` relational foreign key updates and rollback function properly under real PostgreSQL RLS.

### 2.3 Database Schema (Existing)
`opportunities` table (`packages/db/migrations/011_platform_reconciliation.sql`):
- `id uuid NOT NULL`
- `agency_id uuid NOT NULL`
- `location_id uuid NOT NULL`
- `pipeline_id uuid NOT NULL`
- `stage_id uuid NOT NULL`
- `contact_id uuid`
- `name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200)`
- `value numeric(14,2) NOT NULL DEFAULT 0.0`
- `status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'abandoned'))`
- `owner_id uuid REFERENCES users(id) ON DELETE SET NULL`
- `close_date timestamptz`
- `source text`
- `custom_values jsonb NOT NULL DEFAULT '{}'::jsonb`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- PRIMARY KEY (`agency_id`, `location_id`, `id`)
- `FORCE ROW LEVEL SECURITY` with `opportunities_tenant_scope`

---

## 3. Implementation Plan (Strict TDD)

### Step 1: RED Phase
1. Create `packages/db/test/opportunities-repository.test.mjs`:
   - Full CRUD lifecycle under `TenantTx`.
   - Strict multi-tenant isolation negative tests (Cross-Agency, Cross-Location).
   - Stage transition and pipeline filtering.
   - Stage pipeline summary aggregation.
   - Sorting allowlist and SQL injection rejection.
2. Create `apps/api/test/opportunities-api.test.mjs`:
   - HTTP route contract, API key scope checks (`opportunities:read`, `opportunities:write`), CSRF, tenant ID injection stripping, validation.
3. Update `packages/db/test/real-postgres-integration.test.mjs`:
   - Add real PostgreSQL relational merge test.

### Step 2: GREEN Phase
1. Implement `packages/db/lib/opportunities-repository.mjs`:
   - `create(tx, data)`
   - `getById(tx, id)`
   - `list(tx, options)`
   - `update(tx, id, patch)`
   - `updateStage(tx, id, { pipelineId, stageId, status })`
   - `delete(tx, id)`
   - `getPipelineSummary(tx, pipelineId)`
2. Implement `apps/api/routes/opportunities.mjs`:
   - Complete router handling all `/api/crm/opportunities*` and `/api/opportunities*` requests.
3. Wire `apps/api/server.mjs`:
   - Delegate `/api/crm/opportunities` and `/api/opportunities` to `handleOpportunitiesRoutes`.
   - Remove dead generic collection paths for opportunities.

### Step 3: REFACTOR Phase
- Clean up any redundant helper methods.
- Update `packages/db/lib/database.mjs` exports.

### Step 4: VERIFY Phase
Run all 9 testing stages:
1. `node --test packages/db/test/tenant-tx.test.mjs`
2. `node --test packages/db/test/contacts-repository.test.mjs`
3. `node --test packages/db/test/opportunities-repository.test.mjs`
4. `node --test apps/api/test/contacts-api.test.mjs`
5. `node --test apps/api/test/opportunities-api.test.mjs`
6. `node scripts/test-e2e.mjs`
7. `node scripts/verify-ci-postgres.mjs`
8. `npm --workspace=@operza/web run build`
9. `node scripts/seo-audit/run-seo-checks.mjs`
10. `git diff --check`
