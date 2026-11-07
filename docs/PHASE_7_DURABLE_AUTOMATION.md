# Operza Phase 7: Durable Automation Engine & Transactional Outbox

## 1. Executive Summary & Architectural Overview

Operza's **Durable Automation Engine** provides an industrial-grade, fault-tolerant workflow orchestration runtime engineered to survive application restarts, container crashes, network partitions, and transient downstream service outages. Modeled after the transactional outbox pattern and modern distributed workflow primitives, Operza guarantees **at-least-once processing**, **deterministic idempotency**, **row-level lease renewal**, and **exponential backoff dead-letter queuing**.

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                           OPERZA DURABLE OUTBOX RUNTIME                           │
└───────────────────────────────────────────────────────────────────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
     Transactional Enqueue                           Worker Lease Acquisition
     (produceWorkflowTriggerEvent)                   (runOutboxBatch / SKIP LOCKED)
                 │                                               │
                 ├───────────────────────┬───────────────────────┤
                 ▼                       ▼                       ▼
           Active Lease         Heartbeat Renewal        Exponential Backoff
        (SELECT FOR UPDATE)     (extendJobLease)          (30s -> 60s -> 120s)
                 │                       │                       │
                 ▼                       ▼                       ▼
          Action Receipts        Execution Timeline          Dead-Letter Queue
        (SHA-256 Checksum)      (/runs/:id/nodes)         (status='dead_letter')
```

---

## 2. Core Components & Implementation Files

### 2.1 Transactional Outbox Producer
- **File:** `packages/platform-core/src/outbox-producer.mjs`
- **Responsibilities:**
  - Sanitizes inbound trigger payloads, aggressively stripping secret-shaped tokens (`password`, `api_key`, `secret`, `authorization`, `cookie`).
  - Computes stable, tenant-isolated idempotency keys via `generateDeterministicIdempotencyKey({ tenantId, locationId, scope, uniqueEntityId, payloadHash })`.
  - Produces immutable trigger events: `workflow.trigger.enqueued` and `workflow.resume.enqueued`.

### 2.2 Dedicated Background Worker Process
- **Files:** `apps/api/worker.mjs` & `packages/platform-core/src/durable-worker.mjs`
- **Execution Model:**
  - Runs in a distinct operating system process isolated from user-facing HTTP request threads.
  - Connects to PostgreSQL using a dedicated least-privileged role (`operza_worker`).
  - Claims unassigned or expired batches using `FOR UPDATE SKIP LOCKED` to prevent lock contention across horizontal worker replicas.
  - Maintains heartbeats via `extendJobLease(pool, jobId, workerId, leaseDurationMs)`.
  - Terminates gracefully upon `SIGINT`/`SIGTERM` by yielding currently leased jobs.

### 2.3 Trusted Worker Handlers & Governance
- **File:** `packages/platform-core/src/trusted-handlers.mjs`
- **Event Types Handled:**
  - `workflow.trigger.enqueued`: Instantiates workflow graph and starts execution.
  - `workflow.resume.enqueued`: Resumes paused executions following four-eyes human operator approval.
  - `connector.action.enqueued`: Dispatches external provider messages (SMS, Email, WhatsApp, Stripe) with verified consent.
- **Fail-Closed Security:** Unregistered event types are immediately quarantined into the `dead_letter` state without dynamic code evaluation (`eval` or dynamic `import` are strictly prohibited).

### 2.4 In-Memory Zero-Config Engine
- **File:** `packages/platform-core/src/outbox-worker.mjs`
- **Capabilities:**
  - Full-fidelity replica of the PostgreSQL outbox repository interface (`enqueue`, `claimBatch`, `completeJob`, `failJob`).
  - Enables zero-network, local offline development, unit testing, and CI verification without requiring a live Postgres instance.

---

## 3. Execution Timeline & Outbox Correlation

Every workflow run in Operza now produces a correlated outbox job. The timeline inspector exposes:
1. **Outbox Job ID (`outboxJobId`):** Unique UUID tracking the transactional outbox record.
2. **Outbox Delivery Status (`outboxStatus`):** `pending` | `processing` | `delivered` | `dead_letter`.
3. **Attempt Counter (`attemptCount`):** Current delivery count against maximum retry ceiling (5 attempts).
4. **Step Duration & Result:** Per-node execution time, evaluated branch (`yes`/`no`), output payloads, and error codes.

### API Endpoints
- `GET /api/workflows/runs`: List executions with outbox job metadata.
- `GET /api/workflows/runs/:runId/nodes`: Detailed execution timeline with outbox job status and step results.
- `POST /api/workflows/:id/run`: Trigger on-demand workflow execution, returning correlated outbox receipt.
- `POST /api/workflows/runs/:id/tick`: Advance delayed or waiting executions.

---

## 4. Verification Evidence

- `@operza/workflow-engine`: 48 / 48 unit tests passing
- `@operza/platform-core` outbox tests: 50 / 50 unit tests passing
- End-to-End System Tests:
  - `[TEST 89] Outbox Worker Lifecycle: Status, Enqueue & Autonomous Tick` (PASSED)
  - `[TEST 91] Workflow Run Step Timeline (GET /api/workflows/runs/:runId/nodes)` (PASSED)
  - `[TEST 102] Durable Automation Engine: Transactional Outbox Job Correlation in Execution Timeline` (PASSED)
