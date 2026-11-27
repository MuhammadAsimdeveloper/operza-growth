# Security & Tenant Isolation — Stage 14

- **Tenant & Location Boundaries**: Every SQL query runs inside `runInTenantTx(pgPool, tenantCtx, ...)` setting `app.agency_id` and `app.location_id`. All operational tables enforce `FORCE ROW LEVEL SECURITY` with composite `(agency_id, location_id, id)` primary keys.
- **Role & Scope Enforcement**: Read endpoints require `workflows:read`; mutation endpoints (`retry`, `cancel`, `requeue`, `recover-stuck`, `pause`, `resume`) require `workflows:write`.
- **Action Governance & Side-Effect Safety**: `evaluateRetryEligibility` integrates `ACTION_CATALOG` (`action-governance.mjs`) and `workflow_action_receipts` to require explicit operator confirmation (`confirmSideEffectRetry: true`) before retrying external side effects.
- **Log & Payload Redaction**: `sanitizeExecutionPayload` masks secrets, API keys, tokens, passwords, and Bearer headers, and bounds payloads to `4096` bytes.
- **Concurrency & Idempotency**: Row-level `FOR UPDATE` / `FOR UPDATE SKIP LOCKED` and compare-and-set status predicates prevent duplicate retries, duplicate DLQ requeues, and duplicate stuck-execution recovery.
- **Audit Logging**: `retry`, `cancel`, `dead_letter.requeued`, `operations.stuck_recovered`, `pause`, and `resume` emit structured audit events.
