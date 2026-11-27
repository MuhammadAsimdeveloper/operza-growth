# Execution Observability — Workflow Operations 2.0

## 1. Execution & Node Data Exposed
- **Execution Summary (`GET /api/workflows/v2/runs`)**: `id`, `workflowId`, `workflowName`, `workflowVersion`, `status`, `triggerType`, `attemptCount`, `maxAttempts`, `durationMs`, `failureCategory`, `lastErrorCode`, `correlationId`, `traceId`, `createdAt`, `finishedAt`.
- **Execution Detail (`GET /api/workflows/v2/runs/:id`)**: Adds `nodeCounts` (`total`, `completed`, `failed`), redacted `triggerEvent`, `retryEligibility`, `cancellationContract`, ordered `steps`, `attempts`, `logs`, and `receipts`.
- **Node Timeline (`workflow_execution_steps`)**: `nodeId`, `nodeType`, `nodeName`, `executionOrder`, `attempt`, `status`, `durationMs`, `inputSummary` (redacted/bounded), `outputSummary` (redacted/bounded), `errorCode`, `errorMessage`, `failureCategory`, `precedingNodeIds`, `startedAt`, `finishedAt`.

## 2. Redaction & Payload Bounds
- `sanitizeExecutionPayload(payload, maxBytes = 4096)` reuses `redactSensitivePayload` (`graph-validator-v2.mjs`) to mask `password`, `secret`, `token`, `apiKey`, `authorization`, `Bearer ...` strings, and truncates serialized payloads exceeding `4096` bytes.
- `workflow_execution_logs` redacts `metadata_json` on both write (`appendExecutionLog`) and read (`listExecutionLogs` / `getOperationalRunDetail`).
