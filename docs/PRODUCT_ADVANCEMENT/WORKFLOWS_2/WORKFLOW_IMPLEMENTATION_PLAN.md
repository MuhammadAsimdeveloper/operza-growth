# Workflow Builder 2.0 — Implementation Plan

**Date:** 2026-11-26  
**Stage:** Product Advancement Stage 2

## 1. Architecture Strategy
Extend Operza's existing PostgreSQL `TenantTx` + `FORCE RLS` + `@operza/workflow-engine` + React 18 / TanStack Query stack without replacing `node:http`, PostgreSQL, or existing durable lease/outbox tables.

## 2. Implementation Phases
1. **Database Schema & RLS (`packages/db/migrations/041_workflows_2_0.sql`):**
   - `workflow_versions`: Immutable published snapshots `(agency_id, location_id, id)` with `UNIQUE (agency_id, location_id, workflow_id, version_number)`, `graph_json`, `trigger_config`, `checksum`, `published_by`, `published_at`.
   - `workflow_schedules`: UTC `next_run_at`, `timezone` (IANA), `schedule_type` (`once`, `interval`, `cron`), `catchup_policy` (`skip`, `run_once`, `catch_up`), `status` (`active`, `paused`, `completed`), `last_run_at`, `run_count`.
   - `workflow_execution_logs`: Structured, redacted step/branch/governance audit events `(agency_id, location_id, execution_id, node_id, level, event_type, message, metadata_json)`.
   - `workflow_definitions` additive columns: `published_version_id`, `description`, `governance_policy jsonb`, `graph_json jsonb`, `draft_updated_at`.
   - `FORCE ROW LEVEL SECURITY` + `operza_app` and `operza_worker` grants on all new tables.
2. **Core Node Registry, Graph Validator & Scheduler (`packages/workflow-engine/src/`):**
   - `node-registry-v2.mjs`: Authoritative registry for 45+ node types across 7 categories (`triggers`, `crm`, `communication`, `logic`, `data`, `commerce`, `ai`) with schemas, permissions, risk levels, timeout/retry/idempotency policies, and credential requirements.
   - `graph-validator-v2.mjs`: Deterministic DAG & control-flow validator (cycle detection, unreachable node warnings, schema/connection compatibility, loop bounds, max nodes/branches, no executable JS).
   - `branch-executor-v2.mjs`: Deterministic execution semantics for sequential, `if_else`, `switch`, `parallel_split` + `merge` (join barrier), `loop` (bounded iterations), `wait`, `approval_gate`, and `stop`, with secret/token redaction for step I/O.
   - `scheduler-v2.mjs`: UTC + IANA timezone (`Intl.DateTimeFormat`) next-run calculator, DST-safe interval/cron evaluation, and missed-run catch-up evaluator.
3. **Repository & API Routes (`packages/db/lib/workflows-2-repository.mjs`, `apps/api/routes/workflows2.mjs`):**
   - Immutable publish (with optimistic `expectedVersion` concurrency check -> `409 VERSION_CONFLICT`), version history, rollback to previous version, schedule CRUD & next-run preview, redacted execution debugger, and workflow observability metrics.
   - Mount cleanly in `apps/api/routes/workflows.mjs`.
4. **Frontend Workflow Studio 2.0 (`apps/web/src/components/WorkflowCanvas.tsx`, `WorkflowGraphV2.tsx`, `pages/Workflows.tsx`):**
   - Enhance `WorkflowGraphV2.tsx` & `Workflows.tsx` into a 3-pane studio: searchable Node Library (left), interactive Canvas with undo/redo, copy/paste, duplicate, delete, multi-select, zoom/pan/fit, minimap, auto-layout, keyboard shortcuts, and execution status overlay (center), typed Node Config Panel + validation warnings (right), and Execution Debugger / Version History / Schedule drawer.
   - Draft auto-save to `localStorage` with unsaved-changes recovery banner.
5. **Verification & Documentation:**
   - Unit tests (`packages/workflow-engine/test/workflow-2-0.test.mjs`), real PostgreSQL `FORCE RLS` & concurrency tests (`packages/db/test/real-postgres-integration.test.mjs`), API tests, web typecheck/build, marketing build, E2E, SEO audit, and full `verify-ci-postgres.mjs`.
