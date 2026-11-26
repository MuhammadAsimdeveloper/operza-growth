# Execution Engine 2.0 Design

**Modules:**
- `packages/workflow-engine/src/graph-validator-v2.mjs`
- `packages/workflow-engine/src/branch-executor-v2.mjs`
- `packages/workflow-engine/src/scheduler-v2.mjs`

## 1. Execution & Control-Flow Architecture
```
Trigger / Schedule (UTC + IANA)
        │
        ▼
  Graph Validator V2 ──(Reject cycles, unsafe nodes, >maxNodes/maxBranches)
        │
        ▼
  Branch Executor V2
   ├── condition / and_or_condition ──▶ YES / NO handle routing
   ├── switch ────────────────────────▶ case_N / default handle routing
   ├── split_branches ──▶ [branch_a, branch_b] ──▶ merge (all | any barrier)
   ├── loop_items ────────────────────▶ bounded by maxLoopIterations
   ├── wait / approval_gate ──────────▶ durable PostgreSQL pause + resumeNodeId
   └── stop ──────────────────────────▶ clean early termination
```

## 2. Reliability & Governance Guarantees
- **At-least-once with idempotency:** External side effects use `workflow_action_receipts` and provider idempotency keys rather than claiming impossible distributed exactly-once delivery.
- **Bounded Execution:** `normalizeGovernancePolicy` enforces `maxNodes`, `maxSteps`, `maxLoopIterations`, `maxParallelBranches`, `maxDurationMs`, `maxPayloadBytes`, `maxRetries`, and `maxQueuedExecutions`.
- **DST-Safe Scheduling:** `scheduler-v2.mjs` persists `next_run_at` in UTC and resolves local wall-clock cron targets via `Intl.DateTimeFormat` for explicit IANA timezones, with bounded `catchup_policy` (`skip`, `run_once`, `catch_up`).
