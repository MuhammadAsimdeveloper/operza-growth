# Workflow Architecture Audit — Product Advancement Stage 2

**Date:** 2026-11-26  
**Branch:** `feat/operza-agency-launch-readiness`  
**Baseline Commit:** `a2f79fa`

## 1. Executive Summary
Operza Growth already possesses a strong **durable execution foundation** (PostgreSQL `TenantTx` + `FORCE ROW LEVEL SECURITY`, execution leases with heartbeats and `recovery_epoch`, action governance with SHA-256 `action_hash` approval binding, `wait_webhook` resume tokens via `SECURITY DEFINER`, SSRF defense, and an integration hub SDK). However, the **authoring, versioning, scheduling, node-schema, and observability layers** lag behind competitive automation platforms (n8n, Zapier, GoHighLevel).

## 2. Existing Capabilities (Verified in Codebase)
- **Database & RLS (`003`, `012`, `025`, `028`, `029`, `030`):**
  - Composite tenant primary keys `(agency_id, location_id, id)` with `FORCE ROW LEVEL SECURITY` on `workflow_definitions`, `workflow_executions`, `workflow_execution_steps`, and `workflow_approvals`.
  - `workflow_executions` supports `wait_generation`, `workflow_version`, `workflow_snapshot`, `resume_node_id`, `wait_type`, `leased_by`, `lease_expires_at`, `attempts`, `retry_at`, and `recovery_epoch`.
  - `lookup_workflow_execution_by_resume_token` hardened under `operza_auth_definer` with fixed `search_path`.
- **Execution & Governance (`packages/workflow-engine/src/`):**
  - `action-governance.mjs`: 45 registered actions in `ACTION_CATALOG` with `risk` (`read`, `write`, `external_side_effect`), `approval` (`none`, `human`), and `providerKey`.
  - `node-runtime.mjs`: Bounded data operations (`loop_over_items`, `split_out`, `merge`, `aggregate`) capped at `MAX_ITEMS = 1000`, `MAX_STEPS = 500`.
  - `expression-engine.mjs`, `safe-data-mapping.mjs`, `approval-lifecycle.mjs`, `durable-leases.mjs`.
- **Frontend (`apps/web/src/components/` & `pages/Workflows.tsx`):**
  - Custom 2D SVG canvas (`WorkflowCanvas.tsx`, 992 lines) with pan/zoom, bezier edges, `condition` (`yes`/`no`) branching, and dry-run step inspection.
  - `@xyflow/react` preview (`WorkflowGraphV2.tsx`, 83 lines).

## 3. Identified Gaps & Limitations

| Area | Current State | Risk / Limitation | Stage 2 Target |
| :--- | :--- | :--- | :--- |
| **Versioning & Rollback** | `workflow_definitions.version` increments in place | No immutable `workflow_versions` table; cannot diff, audit, or roll back published versions cleanly; concurrent publishes can race without optimistic version check | Dedicated `workflow_versions` + `workflow_audit_logs` tables with `FORCE RLS`, optimistic `version` locking, immutable snapshots, and one-click rollback |
| **Scheduling & Timezones** | `schedule` trigger has `{ every, unit }` only | No IANA timezone support, no DST-safe next-run calculation, no UTC `workflow_schedules` table, no missed-run/catch-up policy, risk of duplicate firing | `workflow_schedules` table with UTC `next_run_at`, IANA `timezone`, `catchup_policy`, pause/resume, and deterministic `Intl.DateTimeFormat` next-run calculator |
| **Node Registry & Schemas** | Split across `ACTION_CATALOG` (45), `workflow-package.mjs` (7 actions), and `Workflows.tsx` (25 kinds) | Schema mismatch (`workflow-package.mjs` rejects most V2 nodes); no unified input/output/config JSON schemas, timeout/retry policies, or permission metadata | Unified `workflow-node-registry.mjs` covering Triggers, CRM 2.0, Comms, Logic/Flow, Data Ops, Commerce, and AI Ops with strict schema & graph validation |
| **Graph & Branch Semantics** | Tree-only `yes`/`no` in `WorkflowCanvas.tsx`; linear list in `WorkflowGraphV2.tsx` | No `switch` multi-branch, parallel branch fan-out/join tracking, loop iteration limits at graph level, or cycle detection | Deterministic DAG + bounded-loop validator, branch completion/join tracking, and Cycle/Dead-end/Unreachable-node validation before publish |
| **Security & Code Nodes** | `Workflows.tsx` exposes `code` ("Custom Code (JS Sandbox)") | Arbitrary user JS in workflow definitions creates security/sandbox risk | Reject executable JS in V2 definitions; provide safe deterministic Data Ops (`set_variable`, `map_fields`, `format_data`, `validate_data`, `convert_types`, `parse_json`, `date_time`, `string_transform`, `filter_array`) |
| **Execution Debugger & Redaction** | Basic step list in `publicWorkflowExecution` | No step I/O preview with secret/PII redaction, no canvas node-status overlay, no bounded payload enforcement, no dead-letter inspection | Redacted step I/O debugger, canvas node status badges (`completed`, `running`, `failed`, `skipped`, `pending`, `waiting_approval`), and dead-letter/retry controls |
| **Visual Builder UX** | Modal-heavy editing in `Workflows.tsx` + custom SVG canvas | No undo/redo, copy/paste, duplicate, multi-select, keyboard shortcuts, node search, draft auto-save/recovery, or right-hand typed config panel | Integrated 3-pane Workflow Studio (Left: searchable Node Library; Center: interactive canvas with undo/redo/copy/paste/shortcuts/minimap; Right: typed Node Config Panel; Bottom/Drawer: Execution Debugger) |
| **CRM 2.0 & Integration SDK** | Legacy contact/tag actions | Missing CRM 2.0 triggers/actions (`find_contact`, `lifecycle_stage`, `create_note`, Smart List membership rules) and unified SDK adapter-to-workflow contract | Wire CRM 2.0 actions/triggers + Integration SDK connector discovery/field-mapping contract |
| **Resource Governance & Observability** | `MAX_ITEMS = 1000`, `MAX_NODES = 200` | No per-workflow execution limits (`maxSteps`, `maxDurationMs`, `maxLoopIterations`, `maxParallelBranches`, `maxPayloadBytes`, `maxQueuedExecutions`) or structured workflow metrics | Enforceable governance policy + `/api/workflows/v2/metrics` observability endpoint with non-PII labels |
