# API & Database Changes — Stage 14

## 1. PostgreSQL Migration `050_workflow_operations_2_0.sql`
- Extended `workflow_executions.status` CHECK constraint with `'retry_scheduled'`.
- Added operational columns to `workflow_executions`: `correlation_id`, `trace_id`, `trigger_type`, `workflow_name`, `failure_category`, `failure_message`, `retryable`, `retry_policy`, `next_retry_at`, `parent_execution_id`, `root_execution_id`, `started_at`, `duration_ms`, `total_nodes_count`, `completed_nodes_count`, `failed_nodes_count`, `cancel_requested_at`, `cancel_requested_by`, `canceled_at`, `dead_lettered_at`, `dead_letter_reason`, `requeued_at`, `requeued_by`, `requeue_count`.
- Extended `workflow_execution_steps` with `'canceled'` status, `node_type`, `node_name`, `execution_order`, `duration_ms`, `input_summary`, `output_summary`, `error_message`, `failure_category`, `preceding_node_ids`, `correlation_id`.
- Created `workflow_execution_attempts` with composite PK `(agency_id, location_id, id)`, `FORCE ROW LEVEL SECURITY`, and grants for `operza_app` and `operza_worker`.

## 2. API Endpoints (`apps/api/routes/workflows2.mjs` & `workflows.mjs`)
- `GET /api/workflows/v2/metrics` (with `workflowId`, `status`, `triggerType`, `failureCategory`, `dateFrom`, `dateTo` filters)
- `GET /api/workflows/v2/runs` (filtered, paginated)
- `GET /api/workflows/v2/runs/:id` (detail, timeline, attempts, logs, receipts, eligibility, cancellation contract)
- `POST /api/workflows/v2/runs/:id/retry`
- `POST /api/workflows/v2/runs/:id/cancel`
- `GET /api/workflows/v2/dead-letters`
- `POST /api/workflows/v2/dead-letters/:id/requeue`
- `POST /api/workflows/v2/operations/recover-stuck`
- `POST /api/workflows/v2/:id/pause` & `POST /api/workflows/v2/:id/resume`
- `POST /api/workflows/:id/run` updated to block `paused` and `archived` workflows with `HTTP 409`.
