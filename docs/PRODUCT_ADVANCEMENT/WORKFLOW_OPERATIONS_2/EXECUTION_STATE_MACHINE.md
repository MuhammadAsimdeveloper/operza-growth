# Execution State Machine — Stage 14

## 1. States (`packages/workflow-engine/src/execution-state.mjs`)
- Active / Queued: `pending`, `enqueued`, `running`, `resuming`, `retry_scheduled`
- Waiting: `waiting`, `waiting_approval`, `waiting_webhook`
- Terminal (automatic runtime): `completed`, `failed`, `canceled`, `dead_letter`

## 2. Transitions & Concurrency Safety
- `running` / `resuming` -> `retry_scheduled` | `dead_letter` | `completed` | `failed` | `canceled` | `waiting*`
- `retry_scheduled` -> `running` | `enqueued` | `canceled` | `failed` | `dead_letter`
- Operator requeue (`canOperatorRequeueState`): explicitly limited to `failed` and `dead_letter` under `SELECT ... FOR UPDATE` and compare-and-set `WHERE status = $prev`.
- Cooperative Cancellation (`evaluateCancellationContract`):
  - `pending | enqueued | waiting | waiting_approval | waiting_webhook | retry_scheduled`: immediate transition to `canceled`.
  - `running | resuming`: records `cancel_requested_at` / `cancel_requested_by` without falsely claiming an in-flight external call was rolled back.
  - Terminal states: cancellation unsupported.
