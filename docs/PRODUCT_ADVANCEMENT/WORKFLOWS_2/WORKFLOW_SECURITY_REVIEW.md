# Workflow 2.0 Security Review

## 1. Controls Implemented
- **No Arbitrary Code Execution:** `validateNodeConfigV2` and `validateWorkflowGraphV2` reject `code`, `raw_sql`, `eval`, prototype-pollution keys (`__proto__`, `constructor`, `prototype`), and `eval(` / `new Function` / `process.env` / `require(` patterns.
- **Credential & PII Redaction:** `validateNodeConfigV2` blocks secret-shaped keys (`password`, `apiKey`, `token`, `secret`, `authorization`, `cookie`) in node configs; `redactSensitivePayload` strips sensitive fields and `Bearer ...` tokens from step I/O, debugger responses (`/api/workflows/v2/runs/:runId/debug`), and `workflow_execution_logs`.
- **Multi-Tenant Isolation (`FORCE RLS`):** `workflow_versions`, `workflow_schedules`, and `workflow_execution_logs` enforce composite `(agency_id, location_id, id)` primary keys and `FORCE ROW LEVEL SECURITY` scoped to `app.agency_id` and `app.location_id`, verified in `real-postgres-integration.test.mjs`.
- **Approval Governance:** High-risk nodes without a preceding `approval_gate` emit publish warnings, and AI nodes remain bound to `action-governance.mjs` and `approval-lifecycle.mjs` without self-approval capability.
