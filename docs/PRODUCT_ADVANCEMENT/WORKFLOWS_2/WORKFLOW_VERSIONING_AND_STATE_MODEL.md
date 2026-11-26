# Workflow Versioning & State Model

**Migration:** `packages/db/migrations/041_workflows_2_0.sql`  
**Repository:** `packages/db/lib/workflows-2-repository.mjs`

## 1. Separation of Concerns
- `workflow_definitions`: Mutable draft state (`graph_json`, `nodes`, `draft_updated_at`, `governance_policy`, `published_version_id`).
- `workflow_versions`: Immutable published snapshots (`version_number`, `status`, `checksum`, `published_by`, `published_at`).
- `workflow_executions`: References exact `workflow_version` and `workflow_snapshot` captured at start so draft edits never mutate in-flight runs.
- `workflow_schedules`: UTC `next_run_at` + IANA `timezone` + `catchup_policy` + `status` (`active`, `paused`, `completed`).
- `workflow_execution_logs`: Redacted structured execution audit logs.

## 2. Concurrency & Rollback
- Publishing acquires `FOR UPDATE` on `workflow_definitions`, validates `expectedVersion` (returning `409 VERSION_CONFLICT` on mismatch), validates the graph via `validateWorkflowGraphV2`, marks prior published versions `superseded`, and inserts a new immutable `workflow_versions` row.
- Rollback copies the target immutable snapshot back into `workflow_definitions` and publishes a new monotonically increasing version number, preserving full audit history.
