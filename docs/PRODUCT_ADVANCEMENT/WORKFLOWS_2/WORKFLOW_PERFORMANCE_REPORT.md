# Workflow 2.0 Performance & Governance Report

## 1. Bounded Execution Limits
Default governance limits enforced by `normalizeGovernancePolicy` and `validateWorkflowGraphV2`:
- `maxNodes`: 200 (hard cap 500)
- `maxSteps`: 500 (hard cap 2000)
- `maxLoopIterations`: 100 (hard cap 500)
- `maxParallelBranches`: 10 (hard cap 25)
- `maxPayloadBytes`: 262,144 bytes (hard cap 1,048,576 bytes)
- `maxDurationMs`: 300,000 ms

## 2. Database Indexing
Migration `041_workflows_2_0.sql` adds:
- `workflow_versions_lookup_idx` on `(agency_id, location_id, workflow_id, version_number DESC)`
- `workflow_schedules_due_idx` partial index on `(agency_id, location_id, next_run_at) WHERE status = 'active'`
- `workflow_execution_logs_exec_idx` on `(agency_id, location_id, execution_id, created_at ASC)`

## 3. Observability
`GET /api/workflows/v2/metrics` computes tenant-scoped execution counts, failure/dead-letter counts, average duration, success rate, and pending approvals without high-cardinality or PII metric labels.
