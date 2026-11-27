# Workflow Execution Operations & Reliability 2.0 — Architecture & Gap Audit

**Stage:** Product Advancement Stage 14 — Workflow Execution Operations & Reliability 2.0
**Branch:** `feat/operza-agency-launch-readiness`
**Starting Commit:** `35bf709`

---

## 1. Existing Workflow Architecture Inventory

1. **Database Schema (`packages/db/migrations/`)**
   - `003_workflow_executions.sql`: Core `workflow_definitions`, `workflow_executions`, and `workflow_execution_steps` tables with composite primary keys `(agency_id, location_id, id)` and `FORCE ROW LEVEL SECURITY`.
   - `012_durable_workflow_leases.sql`: Added `definition_hash`, `worker_lease_id`, `heartbeat_at`, `attempt_count`, `max_attempts`, and lease recovery indexes.
   - `028_durable_workflow_wait_and_resume_lifecycle.sql`: Extended `workflow_executions.status` (`pending`, `enqueued`, `running`, `resuming`, `waiting`, `waiting_approval`, `waiting_webhook`, `completed`, `failed`, `canceled`, `dead_letter`), `workflow_version`, `workflow_snapshot`, `wait_generation`, `resume_node_id`, `wait_type`, and `workflow_execution_steps.status`.
   - `031_durable_action_receipts.sql` & `032_action_receipt_claim_token_fencing.sql`: Durable idempotency receipts (`workflow_action_receipts`) with `started`, `succeeded`, `failed`, `indeterminate` statuses and claim token fencing.
   - `041_workflows_2_0.sql`: Added `workflow_versions` (immutable published snapshots), `workflow_schedules`, `workflow_execution_logs`, and `governance_policy`.

2. **Engine & Core Packages**
   - `packages/workflow-engine/src/execution-state.mjs`: State constants, `STATE_TRANSITIONS`, `isValidStateTransition`, `assertValidStateTransition`.
   - `packages/workflow-engine/src/durable-leases.mjs`: `claimExecutionLease`, `heartbeatExecutionLease`, `releaseExecutionLease`, `recoverAbandonedExecutions`.
   - `packages/workflow-engine/src/action-governance.mjs`: `ACTION_CATALOG` classifying node types by `risk` (`read`, `write`, `external_side_effect`), `approval`, and `providerKey`.
   - `packages/workflow-engine/src/graph-validator-v2.mjs`: `redactSensitivePayload` for key-based and Bearer-token redaction.

3. **API, Repositories & Frontend**
   - `packages/db/lib/workflows-repository.mjs` & `workflows-2-repository.mjs`: Tenant-scoped repositories operating exclusively through `runInTenantTx`.
   - `apps/api/routes/workflows.mjs` & `apps/api/routes/workflows2.mjs`: Endpoints for runs, node timelines, approvals, V2 validation, publishing, schedules, `/api/workflows/v2/metrics`, and `/api/workflows/v2/runs/:id/debug`.
   - `apps/web/src/pages/Workflows.tsx`: Workflow builder with a basic `Recent executions` table and `RunResult` modal.

---

## 2. Identified Gaps for Stage 14

1. **State Machine & Concurrency**: Lacks `retry_scheduled` state, optimistic/row-locked compare-and-set transitions for operator actions, and cooperative cancellation tracking (`cancel_requested_at`, `cancel_requested_by`).
2. **Failure Classification & Retry Policy**: Lacks deterministic failure categorization (`transient_network`, `rate_limit`, `provider_outage`, `invalid_config`, `permission_denied`, `validation_error`, `approval_rejected`, `timeout`, `lease_expired`, `unknown`), bounded exponential backoff + jitter policies, and side-effect safety checks before retrying.
3. **Attempt Lineage & Step Observability**: Lacks a durable `workflow_execution_attempts` table, correlation/trace IDs, and node-level `node_type`, `execution_order`, `duration_ms`, sanitized `input_summary`/`output_summary`, and `preceding_node_ids`.
4. **Dead-Letter Management**: `dead_letter` status exists in DB constraints, but there is no filtered DLQ listing, failure inspection, safe requeue workflow, or duplicate-requeue guard.
5. **Operational Dashboard & Controls UI**: `Workflows.tsx` lacks operational KPIs, failure category breakdowns, execution trends, filtered/paginated execution history, rich node timeline inspection, DLQ management, pause/resume controls, and stuck-execution inspection.
6. **Worker Infrastructure Honesty**: Local environment has no live Redis/BullMQ or multi-worker cluster provisioned; all durable control-plane logic must work against PostgreSQL (`FORCE RLS` + `FOR UPDATE SKIP LOCKED`) and in-memory fallback without claiming distributed staging verification.
