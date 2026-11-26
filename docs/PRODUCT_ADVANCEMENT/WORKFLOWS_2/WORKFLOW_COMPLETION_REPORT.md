# Workflow Builder 2.0 Completion Report (Product Advancement Stage 2)

**Date:** 2026-11-26  
**Branch:** `feat/operza-agency-launch-readiness`  
**Baseline Commit:** `a2f79fa`

## 1. Delivered Capabilities
- **Database Schema & RLS (`packages/db/migrations/041_workflows_2_0.sql`):**
  - Added `workflow_versions` (immutable published snapshots with `UNIQUE (agency_id, location_id, workflow_id, version_number)`), `workflow_schedules` (UTC `next_run_at`, IANA `timezone`, `catchup_policy`), `workflow_execution_logs`, and additive `workflow_definitions` columns (`description`, `published_version_id`, `graph_json`, `governance_policy`, `draft_updated_at`).
  - Enforced `FORCE ROW LEVEL SECURITY` and least-privilege grants for `operza_app` and `operza_worker`.
- **Node Registry & Engine 2.0 (`packages/workflow-engine/src/`):**
  - `node-registry-v2.mjs`: Extensible registry across all 7 categories (`triggers`, `crm`, `communication`, `logic`, `data`, `commerce`, `ai`) with schemas, risk levels, permissions, timeout/retry/idempotency policies, and strict rejection of arbitrary JS/SQL nodes (`code`, `raw_sql`, `eval`).
  - `graph-validator-v2.mjs`: Cycle detection, stop-node/trigger-edge validation, bounded `maxNodes`/`maxParallelBranches`/`maxPayloadBytes`, high-risk approval warnings, and `redactSensitivePayload`.
  - `branch-executor-v2.mjs`: Deterministic execution for sequential, `condition`, `and_or_condition`, `switch`, `split_branches` + `merge` (`all`/`any` barriers), bounded `loop_items`, durable `wait`/`approval_gate`, `stop`, and 9 zero-eval data operations.
  - `scheduler-v2.mjs`: DST-safe UTC + IANA timezone next-run calculator and bounded missed-run catch-up evaluator.
- **Repository & API (`packages/db/lib/workflows-2-repository.mjs`, `apps/api/routes/workflows2.mjs`):**
  - Optimistic-concurrency `publishWorkflowVersion` (`409 VERSION_CONFLICT`), `listWorkflowVersions`, `rollbackWorkflowVersion`, `saveDraftGraph`, timezone schedule CRUD/preview, redacted execution debugger (`/api/workflows/v2/runs/:runId/debug`), and observability metrics (`/api/workflows/v2/metrics`), mounted in `apps/api/routes/workflows.mjs`.
- **Frontend Workflow Studio 2.0 (`apps/web/src/components/WorkflowGraphV2.tsx`, `WorkflowCanvas.tsx`):**
  - 3-pane workspace with searchable Node Library, interactive `@xyflow/react` canvas (undo/redo, copy/paste, duplicate, delete, multi-select, auto-layout, keyboard shortcuts, context menu, minimap, execution node-status overlay, `localStorage` draft auto-save/recovery), and Inspector/Validation panel.

## 2. Verification Summary
- `node --test packages/workflow-engine/test/*.test.mjs`: passed (`exit 0`, including `workflow-2-0.test.mjs` 4/4).
- `node --test packages/platform-core/test/crm-2-0.test.mjs`: passed (`3/3`).
- `npm --workspace=@operza/action-governance test`: passed (`6/6`).
- `npm --workspace=@operza/web run typecheck` & `build`: passed (`exit 0`).
- `npm --workspace=apps/marketing run build`: passed (`5` pages, `exit 0`).
- `node scripts/seo-audit/run-seo-checks.mjs`: passed (`106/106`).
- `node scripts/test-e2e.mjs`: passed (`116/116`).
- `node scripts/verify-ci-postgres.mjs`: passed (`exit 0`, 41/41 migrations under `operza_migrator`, `@operza/db` suite + 130/130 real PostgreSQL integration & `FORCE RLS` checks).
- `git diff --check`: passed (`exit 0`).

## 3. Scope Notes
- Multi-worker Redis/worker staging chaos tests require live Redis/Docker staging containers not started on this local Windows host; local verification covered unit, E2E, and real isolated PostgreSQL `FORCE RLS` concurrency/versioning tests.
- Pre-existing baseline API tests in `apps/api/test/phase-2b-independent-verification.test.mjs` (1 failure) and `apps/api/test/release-verification-gaps.test.mjs` (2 failures) were unchanged from baseline `a2f79fa`; all workflow-specific API tests passed.
