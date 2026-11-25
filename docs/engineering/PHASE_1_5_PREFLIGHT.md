# Phase 1.5 Pre-Flight Audit & Next Phase Scope
## Workflows & Executions Domain Extraction, Workflow Engine v2 Integration & TenantTx Persistence Boundary

**Repository:** `C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Verified Baseline HEAD:** `3d70b37` (`refactor(scheduling): modularize scheduling domain and establish tenant-scoped repository`)  
**Status:** Pre-flight Audited & Phase 1.5 Formally Approved  
**Date:** 2026-11-25  

---

## 1. Verified Repository Baseline

### 1.1 Command Outputs
- `git status --short --branch`: `## feat/operza-agency-launch-readiness...origin/feat/operza-agency-launch-readiness [ahead 2]` (Clean working tree).
- `git rev-parse HEAD`: `3d70b37cf2a825cf298c4ca08a04161e45da5aa7`
- `git branch --show-current`: `feat/operza-agency-launch-readiness`
- `git log -5 --oneline --decorate`:
  - `3d70b37 refactor(scheduling): modularize scheduling domain and establish tenant-scoped repository`
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
| **Phase 1.4** | Scheduling Domain Extraction | **VERIFIED** | `packages/db/test/scheduling-repository.test.mjs` (6 suites passed), `apps/api/test/scheduling-api.test.mjs`, `packages/db/test/appointment-concurrency.test.mjs` verifying PostgreSQL GiST exclusion constraint and error code `23P01`. |

---

## 2. Phase 1.5 Objectives & Architecture Design

### 2.1 Stated Objectives
1. **Extract Workflows Domain Repository:** Implement `packages/db/lib/workflows-repository.mjs` with full CRUD and lifecycle management through `TenantTx`, strictly enforcing PostgreSQL Row Level Security (RLS) on:
   - `workflow_definitions` (definitions CRUD, version tracking, node and trigger validation)
   - `workflow_executions` (execution tracking, status transitions, wait states, lease management)
   - `workflow_execution_steps` (step history, timing, outcomes, audit logging)
   - `workflow_approvals` (approval requests, pending query, cryptographic checksums, decision recordings)
2. **Extract Workflows Domain Router:** Implement `apps/api/routes/workflows.mjs` encapsulating all workflow routing:
   - Definitions CRUD: `GET/POST/PUT/DELETE /api/workflows*` and `GET/POST/PUT/DELETE /api/crm/workflows*`
   - Execution Triggers: `POST /api/workflows/:id/run`
   - Step Testing: `POST /api/workflows/:id/nodes/:nodeId/test`
   - Execution History: `GET /api/workflows/runs` and `GET /api/workflows/runs/:runId/nodes`
   - Approvals Management: `GET /api/workflows/approvals`, `POST /api/workflows/runs/:id/approve`, `POST /api/workflows/runs/:id/reject`
   - Execution Tick & Advancement: `POST /api/workflows/runs/:id/tick`
   - Webhook Triggers: `POST /api/workflows/webhook/:token` and `POST /api/workflows/callbacks/:token`
3. **Strict Multi-Tenant Security & RLS:**
   - Enforce `TenantTx` on all database operations, setting `app.agency_id` and `app.location_id`.
   - Prevent cross-tenant execution reads, definition leaks, or unauthorized approval decisions.
   - Enforce API key scope verification (`workflows:read`, `workflows:write`, `workflows:trigger`).
4. **Authoritative Persistence (Zero Dual-Truth):**
   - When `pgPool` is configured, PostgreSQL is the sole authoritative store. No writing to `state.records.workflows`, `state.workflowExecutions`, or `state.workflowApprovals`.
   - In-memory fallback is isolated exclusively for zero-config offline test runs (`!pgPool`).
5. **Wire & Frontend Compatibility:**
   - 100% compatibility with frontend callers in `apps/web/src/pages/Workflows.tsx` and `apps/web/src/lib/api.ts`.

---

## 3. Database Schema Mapping (Migrations 003, 008, 023, 025, 026, 027)

### `workflow_definitions` table:
- `id uuid NOT NULL`
- `agency_id uuid NOT NULL`
- `location_id uuid NOT NULL`
- `name text NOT NULL CHECK (length(name) BETWEEN 2 AND 150)`
- `status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused', 'archived'))`
- `trigger_type text NOT NULL CHECK (trigger_type IN ('form', 'tag', 'appointment', 'opportunity_stage', 'invoice', 'payment', 'webhook', 'schedule', 'manual'))`
- `trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb`
- `nodes jsonb NOT NULL DEFAULT '[]'::jsonb`
- `version integer NOT NULL DEFAULT 1 CHECK (version > 0)`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- Primary Key: `(agency_id, location_id, id)`
- Foreign Key: `(agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE`
- RLS Policies: `workflow_definitions_tenant_scope` (agency_id and location_id matched to session settings).

### `workflow_executions` table:
- `id uuid NOT NULL`
- `agency_id uuid NOT NULL`
- `location_id uuid NOT NULL`
- `workflow_id uuid NOT NULL`
- `status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'waiting', 'waiting_approval', 'completed', 'failed', 'canceled', 'dead_letter'))`
- `trigger_event jsonb NOT NULL DEFAULT '{}'::jsonb`
- `current_node_id text`
- `resume_node_id text`
- `wait_generation integer DEFAULT 0`
- `wait_type text`
- `state jsonb NOT NULL DEFAULT '{}'::jsonb`
- `state_checksum text`
- `leased_by text`
- `lease_expires_at timestamptz`
- `attempts integer NOT NULL DEFAULT 0`
- `last_error_code text`
- `retry_at timestamptz`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- `finished_at timestamptz`
- Primary Key: `(agency_id, location_id, id)`
- Foreign Key: `(agency_id, location_id, workflow_id) REFERENCES workflow_definitions(agency_id, location_id, id) ON DELETE CASCADE`
- RLS Policies: `workflow_executions_tenant_scope`.

### `workflow_execution_steps` table:
- `id uuid NOT NULL`
- `agency_id uuid NOT NULL`
- `location_id uuid NOT NULL`
- `execution_id uuid NOT NULL`
- `node_id text NOT NULL`
- `attempt integer NOT NULL DEFAULT 1`
- `status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'waiting_approval', 'skipped'))`
- `details jsonb NOT NULL DEFAULT '{}'::jsonb`
- `error_code text`
- `started_at timestamptz NOT NULL DEFAULT now()`
- `finished_at timestamptz`
- Primary Key: `(agency_id, location_id, id)`
- Foreign Key: `(agency_id, location_id, execution_id) REFERENCES workflow_executions(agency_id, location_id, id) ON DELETE CASCADE`
- RLS Policies: `workflow_execution_steps_tenant_scope`.

### `workflow_approvals` table:
- `id uuid NOT NULL`
- `agency_id uuid NOT NULL`
- `location_id uuid NOT NULL`
- `execution_id uuid NOT NULL`
- `workflow_id uuid NOT NULL`
- `node_id text NOT NULL CHECK (length(node_id) BETWEEN 1 AND 180)`
- `action_id text NOT NULL CHECK (length(action_id) BETWEEN 1 AND 180)`
- `action_hash text NOT NULL CHECK (action_hash ~ '^[a-f0-9]{64}$')`
- `requested_by uuid REFERENCES users(id) ON DELETE SET NULL`
- `decided_by uuid REFERENCES users(id) ON DELETE SET NULL`
- `status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','canceled'))`
- `requested_at timestamptz NOT NULL DEFAULT now()`
- `expires_at timestamptz NOT NULL`
- `decided_at timestamptz`
- `request_checksum text NOT NULL CHECK (request_checksum ~ '^[a-f0-9]{64}$')`
- `decision_checksum text CHECK (decision_checksum IS NULL OR decision_checksum ~ '^[a-f0-9]{64}$')`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- Primary Key: `(agency_id, location_id, id)`
- Foreign Key: `(agency_id, location_id, execution_id) REFERENCES workflow_executions(agency_id, location_id, id) ON DELETE CASCADE`
- RLS Policies: `workflow_approvals_app_scope` / `workflow_approvals_worker_scope`.

---

## 4. TDD Execution Plan

1. **RED:**
   - Create `packages/db/test/workflows-repository.test.mjs` testing workflow definitions CRUD, execution records, execution step tracking, approval creation and decisions, and strict cross-tenant RLS isolation.
   - Create `apps/api/test/workflows-api.test.mjs` testing HTTP endpoints: `/api/workflows`, `/api/crm/workflows`, `/api/workflows/:id/run`, `/api/workflows/runs`, `/api/workflows/approvals`, `/api/workflows/runs/:id/approve`, `/api/workflows/runs/:id/reject`, `/api/workflows/runs/:id/tick`, scope checking, ID injection stripping, and multi-tenant isolation.
   - Run tests to prove RED failure.
2. **GREEN:**
   - Create `packages/db/lib/workflows-repository.mjs`.
   - Export `createWorkflowsRepository` from `packages/db/lib/database.mjs`.
   - Create `apps/api/routes/workflows.mjs`.
   - Wire router into `apps/api/routes/crm.mjs` and `apps/api/server.mjs`.
   - Run tests to confirm GREEN passing.
3. **REFACTOR:**
   - Clean up monolithic workflow route blocks in `server.mjs`.
4. **VERIFY:**
   - Run full 10-stage verification suite.
5. **DOCUMENT & COMMIT:**
   - Update `API_ARCHITECTURE_MAP.md` and `ADR_API_MODULARIZATION.md`.
   - Write `docs/engineering/PHASE_1_5_COMPLETION_REPORT.md`.
   - Create artifact and commit.
