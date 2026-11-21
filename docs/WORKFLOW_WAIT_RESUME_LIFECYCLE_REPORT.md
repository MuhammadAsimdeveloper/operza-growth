# Operza Growth — Durable Workflow Wait & Resume Lifecycle
## Persistent Delays, Scheduled Continuations, Worker Ownership & Recovery

**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `d13ab00f3236e015fd105c206472df83f3be3106`  
**Completion Status:** Verified & Green

---

### Executive Summary

In previous iterations, workflow executions encountering `wait` or `delay` nodes experienced execution divergence:
1. In the durable worker (`trusted-handlers.mjs`), only `waiting_approval` and `completed` statuses were explicitly handled. Reaching a `waiting` status hit an unhandled fallback branch that marked the PostgreSQL execution record as `status = 'failed'`.
2. In the API server (`apps/api/server.mjs`), a legacy in-memory timer loop (`startScheduleTriggerLoop`) scanned in-process JSON state (`state.workflowExecutions`) and executed delays synchronously inside the API process.
3. The manual advance endpoint (`POST /api/workflows/runs/:id/tick`) mutated local in-memory state and executed the graph synchronously in the API process instead of delegating continuation to the durable PostgreSQL outbox worker.

This implementation establishes an authoritative, PostgreSQL-backed lifecycle for workflow `wait` and `delay` nodes. Workflows pause, save their exact execution state and variables, schedule an outbox continuation event with `available_at = retryAt`, and resume from the exact downstream node without restarting the graph or re-running the delay node.

---

### Key Architectural Components

#### 1. Execution State Machine (`packages/workflow-engine/src/execution-state.mjs`)
- Formalized `VALID_EXECUTION_STATES`:
  `'pending'`, `'enqueued'`, `'running'`, `'resuming'`, `'waiting'`, `'waiting_approval'`, `'waiting_webhook'`, `'completed'`, `'failed'`, `'canceled'`, `'dead_letter'`.
- Defined explicit state transition validation (`isValidStateTransition`, `assertValidStateTransition`, `isTerminalState`, `isWaitingState`):
  - `pending` -> `enqueued`, `running`, `canceled`, `failed`
  - `enqueued` -> `running`, `resuming`, `canceled`, `failed`
  - `running` -> `waiting`, `waiting_approval`, `waiting_webhook`, `completed`, `failed`, `canceled`
  - `waiting` -> `resuming`, `canceled`, `failed`
  - `resuming` -> `running`, `waiting`, `waiting_approval`, `waiting_webhook`, `completed`, `failed`, `canceled`
  - Terminal states (`completed`, `failed`, `canceled`, `dead_letter`) reject further execution transitions.

#### 2. Database Migration 028 (`packages/db/migrations/028_durable_workflow_wait_and_resume_lifecycle.sql`)
- Updated `workflow_executions_status_check` constraint to include `'enqueued'` and `'waiting_webhook'`.
- Added lifecycle tracking columns to `workflow_executions`:
  - `wait_generation integer NOT NULL DEFAULT 0`: Monotonically incrementing generation counter preventing stale or duplicate continuations.
  - `workflow_version integer NOT NULL DEFAULT 1`: Pinned workflow definition version.
  - `workflow_snapshot jsonb`: Immutable workflow definition snapshot.
  - `resume_node_id text`: The exact next node to resume from when the wait completes.
  - `wait_type text`: Checked for `'timed'`, `'approval'`, or `'webhook'`.
- Updated `workflow_execution_steps_status_check` constraint to permit step statuses `'waiting'` and `'waiting_webhook'`.
- Created partial index `workflow_executions_waiting_retry_idx` on `(agency_id, location_id, retry_at) WHERE status = 'waiting'`.
- Maintained least-privilege role permissions for `operza_app`, `operza_worker`, and `operza_auth_definer`.

#### 3. Transactional Outbox Scheduling (`packages/db/lib/outbox-repository.mjs` & `packages/platform-core/src/outbox-producer.mjs`)
- Extended `createWorkflowOutboxRepository.enqueue()` to accept `availableAt` and optional transactional client `options.client` for atomic commit within an existing transaction.
- Implemented `produceWorkflowWaitResumeEvent()`:
  - Produces `workflow.wait.resume` events with deterministic idempotency keys: `idem_${sha256([tenantId, locationId, 'workflow_wait_resume', `${executionId}_${waitNodeId}_gen_${generation}`])}`.
  - Binds `available_at = retryAt` so outbox workers claiming with `available_at <= now()` cannot pick up delayed jobs prematurely.
- Extended `createMemoryOutboxRepository` in `packages/platform-core/src/outbox-worker.mjs` to honor `availableAt <= now()` timing for in-memory development and testing.

#### 4. Graph Walker Continuation (`packages/workflow-engine/src/engine.mjs`)
- Enhanced `walkGraph()` to support continuation parameters:
  - `deps.resumeNodeId`: Bypasses entrypoint discovery and starts graph traversal directly at `resumeNodeId`.
  - `deps.initialVariables`: Seeds initial variables from persisted execution state.
  - `deps.initialTimeline`: Preserves existing timeline entries across pauses.
- When encountering `wait` or `delay` nodes:
  - Halts traversal immediately.
  - Identifies downstream node (`node.next` or branch target) as `resumeNodeId`.
  - Returns `{ finalStatus: 'waiting', waitingStep, resumeNodeId }`.

#### 5. Worker Handler Implementation (`packages/platform-core/src/trusted-handlers.mjs`)
- **`workflow.trigger.enqueued`:**
  - When graph traversal yields `finalStatus === 'waiting'`:
    - Atomically updates `workflow_executions` to `status = 'waiting'`, `current_node_id = waitNodeId`, `resume_node_id = resumeNodeId`, `wait_generation = 1`, `wait_type = 'timed'`, `retry_at = retryAt`.
    - Inserts `workflow.wait.resume` event into `workflow_outbox` with `available_at = retryAt` within the **exact same PostgreSQL transaction**.
- **`workflow.wait.resume`:**
  - Claims due continuation job.
  - Acquires execution row `FOR UPDATE` in PostgreSQL.
  - Validates `status === 'waiting'` and `wait_generation === payload.resumeGeneration` (fails safe with `ignored_stale_state` or `ignored_stale_generation` if already executed or mismatched).
  - Transitions execution status to `'resuming'`.
  - Executes `walkGraph()` starting from `resume_node_id` without re-running the wait node.
  - If chained wait encountered: increments `wait_generation`, persists new waiting state, and enqueues next continuation in outbox.
  - If terminal completion: marks `status = 'completed'`, clears wait fields, persists step records.
  - If failure: marks `status = 'failed'`, records error code.

#### 6. API Server Decoupling (`apps/api/server.mjs`)
- `startScheduleTriggerLoop`: In PostgreSQL mode (`platformDbEnabled = true`), disables in-process memory scan of delay workflows, leaving scheduling to the durable outbox worker.
- `POST /api/workflows/runs/:id/tick`:
  - In PostgreSQL mode: Locks execution row, validates `status === 'waiting'`, transitions execution to `'resuming'`, and inserts `workflow.wait.resume` with `available_at = now()` into `workflow_outbox`. Returns HTTP 200 without synchronous graph execution in the API process.
  - In local JSON mode: Preserves existing in-memory execution behavior.
- `GET /api/workflows/runs` & `GET /api/workflows/runs/:runId/nodes`: Returns authoritative PostgreSQL records including `retry_at`, `resume_node_id`, `wait_generation`, and `wait_type`.

---

### Verification & Test Suite Summary

1. **`@operza/workflow-engine` Unit Suite:**
   - 71 passing tests (`node --test`).
   - Verified state machine transitions, invalid transition exceptions, wait node suspension, resume node discovery, variable preservation, and chained wait sequencing.
2. **`@operza/platform-core` Suite:**
   - 124 passing tests, 1 skipped live sandbox test.
   - Verified outbox producer deterministic deduplication, generation isolation, future `availableAt` exclusion, and worker continuation execution.
3. **`apps/api` Integration Suite:**
   - `workflow-wait-lifecycle.test.mjs`: 6 passing subtests against ephemeral PostgreSQL cluster.
     - Migration 028 schema and column verification.
     - Atomic wait state persistence and outbox event creation.
     - Temporal claiming boundary enforcement.
     - Resumption from `resume_node_id` to workflow completion.
     - Stale generation / replay rejection.
   - `workflow-persistence-reliability.test.mjs`: 11 passing scenarios including `persistWaitingWorkflowExecution` and `loadAuthoritativeWorkflowExecution`.
4. **`@operza/db` Test Suite:**
   - 107 passing tests, 1 skipped unconfigured test.
   - Verified full production migration pipeline (`runMigrationPipeline()`) with all 28 migrations under `operza_migrator`.

---

### Invariants Maintained

- **No Redis Dependency:** PostgreSQL transactional outbox remains the sole scheduling and queue system.
- **No Third-Party Delivery:** External provider side-effects remain governance-gated; mock/dry-run adapters used in testing.
- **No Migration Tampering:** Migrations 001 through 027 were untouched; all changes are additive in Migration 028.
- **Fail-Closed Security:** Strict tenant and location scoping enforced across all database queries and worker handlers.
