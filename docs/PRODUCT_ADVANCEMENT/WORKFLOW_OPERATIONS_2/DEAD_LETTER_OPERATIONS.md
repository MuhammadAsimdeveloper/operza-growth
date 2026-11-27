# Dead-Letter Operations

## 1. Durable Persistence
- Exhausted or permanently failed executions reside in `workflow_executions` with `status = 'dead_letter'`, `dead_lettered_at`, `dead_letter_reason`, `failure_category`, `last_error_code`, and `requeue_count`.
- Attempt lineage is stored in `workflow_execution_attempts` (`UNIQUE (agency_id, location_id, execution_id, attempt_number)`).

## 2. Tenant-Scoped Operations
- `GET /api/workflows/v2/dead-letters`: Filtered by `workflowId`, `failureCategory`, `dateFrom`, `dateTo`, `search`, with bounded `limit`/`offset`.
- `POST /api/workflows/v2/dead-letters/:id/requeue`: Uses `SELECT ... FOR UPDATE`, verifies `status === 'dead_letter'` (preventing duplicate requeues), enforces `evaluateRetryEligibility` and side-effect confirmation, increments `requeue_count` and `attempt_count`, records an attempt row, appends a redacted log, and writes an audit event (`workflow.dead_letter.requeued`).
