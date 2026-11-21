# OPERZA GROWTH — DURABLE ACTION IDEMPOTENCY & EXECUTION RECEIPTS REPORT

**Repository:** `MuhammadAsimdeveloper/operza-growth`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Base Commit Clarification:** The git repository HEAD at the start of this phase was verified as `043062d9859f5a23289bc6206927ea1b454bf007` (which incorporates Phase 20.2.5.11 and the previous lease fencing commit `5cd70f149d96238f39afda07bca8cbecb2253975`; prior documentation noted `855154bc4b7c8027ee67dcc16a2b30e99b0f62c9`).  
**Commit Message:** `feat(workflows): persist idempotent action receipts`  
**Phase Status:** Complete, Verified, Production-Hardened  

---

## 1. Executive Summary

This phase implements production-grade durable idempotency for every supported workflow action that mutates CRM data or causes an external side effect.

In high-concurrency and distributed workflow engines, duplicate deliveries are inevitable due to network blips, worker crashes, lease expirations, and manual ticks. Without durable transactional receipts, retried operations risk duplicating customer tasks, corrupting lead scores, or double-charging/double-messaging external recipients.

The implementation guarantees:
1. **Atomic In-Transaction CRM Mutations:** All 8 CRM mutations (`addContactTag`, `createTask`, `updateOpportunityStage`, `updateContact`, `createOpportunity`, `assignContact`, `updateLeadScore`, `sendInternalNotification`) execute in a single atomic PostgreSQL transaction following the strict lifecycle: `claim -> mutate -> complete -> commit`. If any error occurs or the worker crashes before commit, the database rolls back atomically, leaving zero orphaned receipts and zero corrupted rows.
2. **Pre-Claimed Remote Side Effects:** External providers (SendGrid, Twilio, WhatsApp, Zapier Webhook) pre-claim receipts with worker lease fencing and deterministic idempotency keys before dispatch. Replays return the stored receipt without re-dispatching.
3. **Fail-Closed Ambiguity Handling:** Timeouts and network connection aborts during external dispatch transition receipts to `indeterminate`, permanently blocking blind retries without operator reconciliation.
4. **Stable Canonical Identity:** Action hashing computes cryptographic SHA-256 digests over immutable execution identity and normalized payloads while strictly excluding dynamic authorization artifacts (`consent`, `providerStatus`, `mode`, `actorId`, timestamps, secrets).
5. **Least-Privilege Database Roles:** Strict isolation and row-level security (RLS) verified under both `operza_app` and `operza_worker` roles with `FORCE ROW LEVEL SECURITY`.

---

## 2. Database Schema & Migration 031

Migration `031_durable_action_receipts.sql` safely hardens `workflow_action_receipts` additively:

```sql
-- Migration 031: Durable Action Receipts & Lease Fencing

ALTER TABLE workflow_action_receipts
  DROP CONSTRAINT IF EXISTS workflow_action_receipts_status_check;

ALTER TABLE workflow_action_receipts
  ADD CONSTRAINT workflow_action_receipts_status_check
  CHECK (status IN ('started', 'succeeded', 'failed', 'indeterminate'));

ALTER TABLE workflow_action_receipts
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS outcome_details JSONB;

CREATE INDEX IF NOT EXISTS idx_action_receipts_lease_recovery
  ON workflow_action_receipts (status, lease_until)
  WHERE status = 'started';
```

### State Machine Lifecycle

```
                 [claimActionReceipt]
                       |
                       v
                 +-----------+
                 |  started  |  (Lease-fenced by lease_owner & lease_until)
                 +-----------+
                   /    |    \
     [complete]   /     |     \  [ambiguous timeout]
                 v      |      v
  +-------------+       |     +---------------+
  |  succeeded  |       |     | indeterminate |  (BLOCKED from blind replay)
  +-------------+       |     +---------------+
                        v
                  +-----------+
                  |  failed   |  (Explicit non-retryable rejection)
                  +-----------+
```

- **`started`**: Claimed by a worker for up to `leaseMs` (default 60,000ms). Concurrent workers claiming the same action hash receive `ACTION_ALREADY_IN_PROGRESS` or a unique constraint collision. If a worker crashes, the lease expires, allowing recovery workers to safely reclaim.
- **`succeeded`**: Terminal success storing canonical result payload (`outcome_details`). Subsequent executions return this record immediately without repeating mutations.
- **`failed`**: Terminal failure with `last_error_code` recorded.
- **`indeterminate`**: Assigned when remote dispatch suffers a socket timeout, network abort, or indeterminate HTTP error. Prevents dangerous automated re-dispatch.

---

## 3. Transaction-Aware Receipt Repository

Implemented in `packages/db/lib/outbox-repository.mjs`:

1. **`claimActionReceipt(receiptData, { client } = {})`**:
   - Supports caller-supplied PostgreSQL transaction client.
   - Cleanses credentials and secrets before storing.
   - Uses `ON CONFLICT (agency_id, action_hash) DO UPDATE` with lease fencing logic (`lease_until < clock_timestamp()`).
   - If row is currently leased and not expired, throws `ACTION_ALREADY_IN_PROGRESS`.
2. **`completeActionReceipt(tenantId, actionHash, outcomeDetails, { client } = {})`**:
   - Validates tenant boundary and cleanses outcome details of secrets.
   - Updates status to `succeeded`, sets `completed_at = clock_timestamp()`, and clears leases.
3. **`failActionReceipt(tenantId, actionHash, { errorCode, errorDetails, indeterminate = false }, { client } = {})`**:
   - Safely records failure code and sets status to either `failed` or `indeterminate`.

---

## 4. Stable Canonical Action Identity Hashing

Implemented in `packages/workflow-engine/src/action-governance.mjs`:

### Separation of Concerns
Idempotency identity must never drift when transient approval metadata changes. The canonical action hash is computed as:
$$\text{actionHash} = \text{SHA-256}(\text{agencyId} \mathbin{\Vert} \text{locationId} \mathbin{\Vert} \text{workflowId} \mathbin{\Vert} \text{executionId} \mathbin{\Vert} \text{nodeId} \mathbin{\Vert} \text{actionType} \mathbin{\Vert} \text{invocationKey} \mathbin{\Vert} \text{canonical}(\text{input}))$$

- **Included:** `agencyId`, `locationId`, `workflowId`, `executionId`, `nodeId`, `actionType`, `invocationKey`, canonical sorted JSON payload.
- **Excluded:** `consent`, `providerStatus`, `mode`, `actorId`, timestamps, ephemeral execution tokens, secrets.
- **`authHash`:** Calculated separately for authorization verification:
$$\text{authHash} = \text{SHA-256}(\text{actionHash} \mathbin{\Vert} \text{mode} \mathbin{\Vert} \text{providerStatus} \mathbin{\Vert} \text{consent} \mathbin{\Vert} \text{actorId})$$

---

## 5. Atomic In-Transaction CRM Mutations Matrix

Implemented in `packages/platform-core/src/trusted-handlers.mjs` via `executeAtomicCrmAction`:

| Action Method | CRM Operation | Target Table | Idempotency & Rollback Guarantees |
| :--- | :--- | :--- | :--- |
| `addContactTag` | Tag contact | `contacts` | Appends tag to `tags` array; duplicates filtered out. Rolls back receipt on failure. |
| `createTask` | Create CRM task | `tasks` | Claims receipt, inserts single task row, completes receipt in same transaction. |
| `updateOpportunityStage` | Update opportunity stage | `opportunities` | Idempotently updates opportunity `stage`, creates history entry, commits receipt. |
| `updateContact` | Update contact attributes | `contacts` | Updates contact attributes safely in tenant context. |
| `createOpportunity` | Create new deal/pipeline | `opportunities` | Atomically creates opportunity record and binds receipt. |
| `assignContact` | Assign contact to agent | `contacts` | Updates `assigned_user_id` atomically. |
| `updateLeadScore` | Increment lead score | `lead_scores` | Atomically increments score and adds audit log in transaction. |
| `sendInternalNotification` | Dispatch internal alert | `notifications` | Creates in-app staff notification in transaction. |

Every operation verifies:
$$\text{Transaction Start} \longrightarrow \text{claimActionReceipt} \longrightarrow \text{Execute Mutation} \longrightarrow \text{completeActionReceipt} \longrightarrow \text{Transaction Commit}$$
If an error occurs at any point before commit, `ROLLBACK` removes both the mutation and the receipt, preventing ghost records or uncommitted state.

---

## 6. Remote Provider Dispatch & Zapier Webhook Safety

Implemented in `packages/platform-core/src/provider-adapters.mjs` and `trusted-handlers.mjs`:

1. **Pre-Claim Before Dispatch:**
   Receipt claimed with `status = 'started'` prior to calling provider API.
2. **Deterministic Idempotency Key:**
   Header `Idempotency-Key` generated from `actionHash` and passed to outbound HTTP calls.
3. **Zapier Webhook Adapter:**
   - Registered under key `zapier` with action type `external_side_effect`.
   - Requires valid HTTPS URL; rejects unencrypted HTTP and private RFC 1918 addresses.
   - Signs outbound payload using HMAC-SHA256 (`x-operza-signature`).
   - Strips secrets and credential references.
   - Non-2xx HTTP responses or fetch errors throw `ZAPIER_DISPATCH_FAILED` (never fake success).
4. **Timeout Handling:**
   AbortController timeouts and connection resets throw with `PROVIDER_TIMEOUT_INDETERMINATE`, transitioning receipt to `indeterminate`.

---

## 7. Security Review & Multi-Tenant RLS Enforcement

The receipt table and workflow handlers enforce:
- **`FORCE ROW LEVEL SECURITY`** on `workflow_action_receipts`.
- All operations require transaction-local tenant context (`set_config('app.agency_id', ..., true)` and `set_config('app.location_id', ..., true)`).
- **`operza_app` role:** Strictly confined to current tenant and location; cross-tenant reads or writes return 0 rows or throw.
- **`operza_worker` role:** Bound by RLS policies during job and receipt processing.
- Missing context fails closed.

---

## 8. Comprehensive 25-Scenario Verification Matrix

All 25 required regression test scenarios implemented in `packages/platform-core/test/action-receipt-idempotency.test.mjs` and verified against real PostgreSQL:

| Scenario | Objective | Status |
| :--- | :--- | :--- |
| **Scenario 1** | Concurrent duplicate task creation results in exactly 1 task record | **PASS** |
| **Scenario 2** | Duplicate contact tag addition is idempotent and records receipt | **PASS** |
| **Scenario 3** | Opportunity stage updating idempotently records receipts | **PASS** |
| **Scenario 4** | Worker restart/replay re-runs workflow without duplicating CRM records | **PASS** |
| **Scenario 5** | Transaction rollback on CRM failure leaves zero orphaned succeeded receipt | **PASS** |
| **Scenario 6** | Uncommitted worker transaction leaves no receipt and no mutated row | **PASS** |
| **Scenario 7** | Worker serialization throws ACTION_ALREADY_IN_PROGRESS on concurrent claim | **PASS** |
| **Scenario 8** | Duplicate provider redispatch prevention returns stored receipt | **PASS** |
| **Scenario 9** | Concurrent provider claim serializes and blocks concurrent dispatch | **PASS** |
| **Scenario 10** | Idempotency-Key is deterministic and stable across retries | **PASS** |
| **Scenario 11** | Pre-dispatch crash allows recovery worker to retry after lease expiration | **PASS** |
| **Scenario 12** | Ambiguous timeout / abort is marked indeterminate in receipt | **PASS** |
| **Scenario 13** | Indeterminate status is blocked from blind re-dispatch | **PASS** |
| **Scenario 14** | Zero secrets stored in workflow_action_receipts table | **PASS** |
| **Scenario 15** | Trusted actor identity is recorded and verified in governance | **PASS** |
| **Scenario 16** | Missing or invalid actor identity fails closed in sensitive nodes | **PASS** |
| **Scenario 17** | Consent missing throws CONSENT_REQUIRED before dispatch | **PASS** |
| **Scenario 18** | Dry-run execution generates zero durable receipts and zero CRM mutations | **PASS** |
| **Scenario 19** | Zapier fetch failure is recorded as ZAPIER_DISPATCH_FAILED, never fake success | **PASS** |
| **Scenario 20** | Calling unsupported CRM action fails closed with CRM_ACTION_UNSUPPORTED | **PASS** |
| **Scenario 21** | `operza_app` role is constrained to tenant scope under FORCE RLS | **PASS** |
| **Scenario 22** | `operza_worker` role claims and completes receipts under FORCE RLS | **PASS** |
| **Scenario 23** | Missing tenant context fails closed under RLS | **PASS** |
| **Scenario 24** | Cross-tenant access is strictly denied under FORCE RLS | **PASS** |
| **Scenario 25** | Concurrent claims on identical action hash are serialized by database constraint | **PASS** |

---

## 9. Test Suite Summary

- **`@operza/workflow-engine`**: 71 tests passed (0 failures).
- **`@operza/platform-core`**: 150 tests passed, 1 skipped (0 failures).
- **`@operza/db`**: 107 tests passed, 1 skipped (0 failures). All 31 migrations applied.
- **`scripts/verify-ci-postgres.mjs`**: Full isolated PostgreSQL CI pipeline passed.

---

## 10. Remote GitHub Actions CI Notice

> **Notice Regarding Remote GitHub Actions CI:**  
> Remote GitHub Actions CI runs remain **UNVERIFIED** on GitHub infrastructure due to the organization repository account spending limit lock (`Resource not accessible by integration / billing limit`). All verification has been executed locally using dynamically allocated, isolated PostgreSQL 16 test clusters with full least-privilege role bootstrapping, migration execution (001–031), and FORCE RLS assertions.
