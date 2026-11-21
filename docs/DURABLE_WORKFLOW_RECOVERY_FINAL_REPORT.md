# Operza Growth — Durable Workflow Recovery & Execution Ownership
## Final Engineering Verification & Correctness Report

**Repository:** `MuhammadAsimdeveloper/operza-growth`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Base Commit:** `e552824f607534e804b0513a3777633652e242cb`  
**Date:** November 21, 2026  
**Status:** COMPLETE & VERIFIED  

---

## 1. Executive Summary

This phase completes the durable workflow wait and resume lifecycle for Operza Growth. Following the initial implementation of wait and delay persistence, independent code review identified critical edge cases in worker interruption, manual tick status semantics, execution snapshot pinning, and webhook wait callback ingestion.

All identified deficiencies have been addressed:
1. **Recoverable Worker Resume Leases:** Added PostgreSQL-backed lease tracking (`resume_lease_owner`, `resume_lease_until`, `resume_started_at`) to guarantee that active executions cannot be executed concurrently, while stalled or crashed worker executions can be safely recovered by another worker after lease expiration.
2. **Three-Stage Execution Protocol:** Strict separation of lease claiming (Stage 1, transaction-isolated), graph walk execution (Stage 2, outside database transactions to eliminate long-running lock contention), and lease-ownership verification before persisting final outcomes (Stage 3, atomic commit and lease release).
3. **Workflow Version & Snapshot Pinning:** Workflows pin their sanitized definition and version at execution initialization; executions continue using their original pinned snapshot even when a new version (v2+) is published.
4. **Manual Tick Idempotency:** `POST /api/workflows/runs/:id/tick` expedites pending scheduled outbox events or inserts deterministic continuations, returning truthful status codes (`resume_enqueued` vs `resume_already_requested`) without graph execution in the API process.
5. **Webhook Wait Ingress:** Added dedicated webhook callback token resolution via security definer function `lookup_workflow_execution_by_resume_token`, atomic single-use token consumption, and resumption outbox event queuing.
6. **Additive Migration 029:** Cleanly applied via least-privilege `operza_migrator` role.
7. **Comprehensive Testing:** Verified with 7/7 new crash-and-recovery integration tests on isolated PostgreSQL, with 100% pass rates across `@operza/workflow-engine`, `@operza/platform-core`, and `@operza/db`.

---

## 2. Root Cause Analysis of Previous Defects

1. **Manual Tick Status Mismatch:**
   - *Defect:* The manual tick endpoint returned `{ status: 'resuming' }` immediately from the API, while the asynchronous worker was responsible for transitioning the execution. If an execution was already pending, it could produce duplicate `workflow.wait.resume` entries with non-deterministic idempotency keys (using `Date.now()`).
   - *Resolution:* The endpoint now inspects `workflow_outbox` for existing pending events for the execution and generation. If present, it updates `available_at = now()` to expedite execution; otherwise, it enqueues a deterministic idempotent continuation. The API returns `{ status: 'resume_enqueued' }` or `{ status: 'resume_already_requested' }` and keeps execution status as `waiting`.
2. **Worker Interruption & Stranded Executions:**
   - *Defect:* If a worker crashed while executing a resumed workflow, the execution remained stranded in `resuming` state indefinitely with no mechanism for other workers to distinguish an active worker from a dead one.
   - *Resolution:* Introduced a 60-second lease window with owner token identity. Workers verify lease validity. If a lease expires, any eligible worker can safely recover the execution and resume processing.
3. **Workflow Version & Snapshot Drift:**
   - *Defect:* Resuming executions could reload definitions from `workflow_definitions` by ID, picking up post-launch modifications to node configurations rather than executing the exact version the workflow started with.
   - *Resolution:* Added `sanitizeWorkflowSnapshot` and pinned `workflow_version` and `workflow_snapshot` to `workflow_executions`. Graph resumption now strictly utilizes the pinned snapshot.
4. **Execution Terminal State Inaccuracies:**
   - *Defect:* Multi-step flows could overwrite paused wait states or fail to distinguish webhook pauses from timed delays or approvals.
   - *Resolution:* Formalized five authoritative execution states (`waiting`, `waiting_approval`, `waiting_webhook`, `completed`, `failed`). Resumption handlers inspect the final graph status and transition to the precise matching state.
5. **Outbox Credential Leak Prevention:**
   - *Defect:* Passing raw workflow definitions through outbox event payloads violated the outbox repository's credential sanitization rules (`OUTBOX_CREDENTIAL_FIELD`).
   - *Resolution:* Removed `flow` payloads from outbox events; workers load authoritative snapshots directly from the database under tenant context.

---

## 3. Database Architecture & Additive Migration 029

File: `packages/db/migrations/029_durable_workflow_resume_leases.sql`

### 3.1 DDL Schema Additions
```sql
ALTER TABLE workflow_executions
  ADD COLUMN IF NOT EXISTS resume_lease_owner text,
  ADD COLUMN IF NOT EXISTS resume_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS resume_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS resume_token text;

CREATE INDEX IF NOT EXISTS workflow_executions_resume_recovery_idx
  ON workflow_executions (status, resume_lease_until)
  WHERE status = 'resuming';

CREATE UNIQUE INDEX IF NOT EXISTS workflow_executions_resume_token_idx
  ON workflow_executions (resume_token)
  WHERE resume_token IS NOT NULL;
```

### 3.2 Security Definer Token Lookup Function
```sql
CREATE OR REPLACE FUNCTION lookup_workflow_execution_by_resume_token(p_token text)
RETURNS TABLE (
  id uuid,
  agency_id uuid,
  location_id uuid,
  workflow_id uuid,
  status text,
  current_node_id text,
  resume_node_id text,
  wait_generation integer,
  wait_type text,
  retry_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.agency_id, e.location_id, e.workflow_id, e.status,
         e.current_node_id, e.resume_node_id, e.wait_generation, e.wait_type,
         e.retry_at, e.created_at
  FROM workflow_executions e
  WHERE e.resume_token = p_token
    AND e.resume_token IS NOT NULL
    AND e.status = 'waiting_webhook'
  LIMIT 1;
$$;

ALTER FUNCTION lookup_workflow_execution_by_resume_token(text) OWNER TO operza_auth_definer;
GRANT EXECUTE ON FUNCTION lookup_workflow_execution_by_resume_token(text) TO operza_app, operza_worker;
```

---

## 4. Recoverable Worker Resume Lease Protocol

The worker handler `workflow.wait.resume` strictly follows a 3-stage protocol:

```
+----------------------------------------------------------------------------------+
| Stage 1: Atomic Claim & Lease Grant                                              |
| - Connect to DB with tenant RLS context (app.agency_id, app.location_id)         |
| - SELECT ... FOR UPDATE on workflow_executions                                  |
| - Validate wait_generation, terminal states, and existing lease status           |
| - If active lease owned by another worker -> fail with RESUME_LEASE_ACTIVE_CONFLICT|
| - If lease expired -> recover and assign new workerToken & 60s lease window      |
| - Set status = 'resuming', COMMIT transaction                                    |
+----------------------------------------------------------------------------------+
                                        │
                                        ▼
+----------------------------------------------------------------------------------+
| Stage 2: Graph Execution (Outside DB Transaction)                                |
| - Load pinned workflow snapshot and state                                        |
| - Execute walkGraph starting from resumeNodeId with callbackData/context         |
| - Zero database lock contention during external API/action calls                 |
+----------------------------------------------------------------------------------+
                                        │
                                        ▼
+----------------------------------------------------------------------------------+
| Stage 3: Ownership Verification & Outcome Persistence                             |
| - Connect to DB with tenant RLS context                                          |
| - SELECT ... FOR UPDATE checking resume_lease_owner === workerToken              |
| - If lease lost or taken over -> abort commit (log workflow.resume.lease_lost)   |
| - Persist final execution outcome (completed, waiting, waiting_webhook, etc.)    |
| - Clear resume_lease_owner, resume_lease_until, and resume_started_at            |
| - Enqueue next outbox continuation if paused on chained wait node                |
| - COMMIT transaction and release client                                          |
+----------------------------------------------------------------------------------+
```

---

## 5. Webhook Ingress & Manual Tick Lifecycle

### 5.1 Webhook Callback Ingress (`POST /api/workflows/callbacks/:token`)
1. **Tenant-Safe Resolution:** Looks up the execution record using `lookup_workflow_execution_by_resume_token(p_token)` owned by `operza_auth_definer`.
2. **Expiry Verification:** Rejects expired callbacks with HTTP 410 Gone if `retry_at` is in the past.
3. **Atomic Single-Use Consumption:** Sets `resume_token = NULL`, saves incoming payload to `state.callbackData`, and resets status to `waiting`.
4. **Resumption Enqueue:** Inserts a `workflow.wait.resume` event with `requestType = 'webhook'` and `available_at = now()`.
5. **Replay Rejection:** Subsequent requests with the same token fail with HTTP 404 or HTTP 409.

### 5.2 Manual Tick Ingress (`POST /api/workflows/runs/:id/tick`)
1. **State Gate:** Rejects runs not in `waiting` or expired `resuming` state with HTTP 409 Conflict.
2. **Continuation Expediting:** If a scheduled `workflow.wait.resume` outbox event exists, updates `available_at = now()` and returns `{ status: 'resume_enqueued' }`. If already due, returns `{ status: 'resume_already_requested' }`.
3. **Deterministic Idempotency Key:** For new events, computes `sha256([agencyId, locationId, 'workflow_wait_resume', `${runId}_${waitNode}_gen_${waitGen}`])`.
4. **Zero Graph Execution:** Execution is strictly delegated to the outbox worker.

---

## 6. Verification Results Matrix

| Test Suite | File | Results | Environment |
| :--- | :--- | :--- | :--- |
| **Recovery & Leases Suite** | `apps/api/test/workflow-recovery-and-leases.test.mjs` | **7 / 7 PASSED** | Isolated PostgreSQL 18 |
| **Wait Lifecycle Suite** | `apps/api/test/workflow-wait-lifecycle.test.mjs` | **6 / 6 PASSED** | Isolated PostgreSQL 18 |
| **Workflow Persistence Reliability** | `apps/api/test/workflow-persistence-reliability.test.mjs` | **11 / 11 PASSED** | Real PostgreSQL + Mock |
| **Workflow Engine Core** | `packages/workflow-engine/` | **71 / 71 PASSED** | Node.js Test Runner |
| **Platform Core Outbox & Handlers** | `packages/platform-core/` | **124 / 124 PASSED** (1 skipped sandbox) | Node.js Test Runner |
| **Database RLS & Migrations (001-029)** | `packages/db/` | **107 / 107 PASSED** (1 skipped url guard) | Isolated PostgreSQL 18 |
| **CI PostgreSQL Verification Script** | `scripts/verify-ci-postgres.mjs` | **ALL SUITES PASSED** | Isolated PostgreSQL 18 |

### Key Test Scenarios Verified:
1. `Setup schema and apply all migrations up through 029` — verified 29 sequential migration files applied under `operza_migrator`.
2. `Manual tick expedites scheduled continuation and prevents duplicate execution` — verified idempotent duplicate rejection.
3. `Active resume lease prevents concurrent execution; expired lease recovers` — verified `RESUME_LEASE_ACTIVE_CONFLICT` on concurrent access, followed by clean recovery after expiration.
4. `Stale generation and terminal executions are rejected without side effects` — verified stale generations log `ignored_stale_generation`.
5. `Workflow version and snapshot are pinned on execution and unaffected by publishing v2` — verified v1 snapshot retention.
6. `Webhook wait node pauses in waiting_webhook, sets token, and consumes callback securely` — verified single-use token consumption and execution resumption.

---

## 7. Remote CI Status Disclosure

> [!WARNING]
> Remote GitHub Actions CI remains **UNVERIFIED** due to a pre-existing billing restriction on the GitHub repository account (`MuhammadAsimdeveloper/operza-growth`). All verifications have been conducted with complete test isolation against ephemeral PostgreSQL clusters locally using the identical PostgreSQL 18 engine and migration sequence configured for production.

---

## 8. Strict Scope Compliance Statement

- **No External Queues or Redis:** Persistence and queueing rely solely on PostgreSQL relational tables and outbox locking.
- **No Third-Party Network Calls:** No live third-party services (Twilio, SendGrid, Meta, Stripe) were activated or called.
- **No UI/Frontend Modification:** All changes were strictly confined to server endpoints, worker handlers, database migrations, and integration test suites.
- **No Branch Merging or Production Deployment:** Work is committed strictly on `feat/operza-agency-launch-readiness`.
