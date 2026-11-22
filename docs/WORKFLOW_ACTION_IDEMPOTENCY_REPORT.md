# OPERZA GROWTH — PHASE 31.1: ACTION RECEIPT FENCING & PROVIDER RECOVERY HARDENING REPORT

**Repository:** `MuhammadAsimdeveloper/operza-growth`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `ef56a8f38a916285d1ea4f89248b993172a22401`  
**Required Commit Message:** `fix(workflows): fence action receipts and safe provider recovery`  
**Phase Status:** Complete, Verified, Production-Hardened  

---

## 1. Executive Summary

Phase 31.1 completes the durable action idempotency sequence by hardening action receipt ownership fencing, preventing zombie/stale worker completion races, implementing a provider capability matrix for safe crash recovery, conservatively classifying network transport ambiguities, and stabilizing canonical action identity.

In high-concurrency environments, worker crashes, lease expirations, and network delays create conditions where:
1. A slow worker may attempt to complete or fail a receipt after its lease expired and another worker took over. Relying solely on `workerId` fails when worker process names are static or reused across restarts.
2. Reclaiming an expired `started` receipt for providers without verified idempotency (such as SendGrid, Twilio, WhatsApp, and generic Zapier webhooks) causes duplicate customer emails, SMS, or webhook firings.
3. Network connection resets or worker aborts during transmission could be misclassified as deterministic failures or swallowed.
4. Dynamic template variables or relative due dates could compute varying action hashes across retries, fragmenting idempotency.

This implementation resolves every gap through database migration 032, per-attempt `claim_token` UUID fencing, a provider capability registry, conservative transport classification, and strict runtime governance.

---

## 2. Database Migration 032: Claim Token & Fencing Index

Migration `032_action_receipt_claim_token_fencing.sql` introduces:

```sql
-- Migration 032: Action Receipt Claim Token Fencing
ALTER TABLE workflow_action_receipts
  ADD COLUMN IF NOT EXISTS claim_token TEXT;

CREATE INDEX IF NOT EXISTS idx_action_receipts_claim_fence
  ON workflow_action_receipts (agency_id, action_hash, claim_token, lease_until)
  WHERE status = 'started';
```

### Claim Token Lifecycle & Fencing Invariant

1. **Claim Generation:** Whenever an action receipt is claimed (initial attempt or recovery of an expired lease), `claimActionReceipt` generates a cryptographically secure random UUID `claimToken`.
2. **Atomic Registration:** The `claim_token` is persisted alongside `lease_owner`, `lease_until`, and `status = 'started'`.
3. **Fenced Completion & Failure:** Both `completeActionReceipt` and `failActionReceipt` require `claimToken` and execute with an atomic SQL predicate:
   ```sql
   UPDATE workflow_action_receipts
   SET status = 'succeeded', completed_at = clock_timestamp(), ...
   WHERE agency_id = $1
     AND action_hash = $2
     AND claim_token = $3
     AND lease_until > clock_timestamp()
     AND status = 'started'
   ```
4. **Fail-Closed Rejection:** If `rowCount === 0`:
   - If the receipt is in terminal status (`succeeded`, `failed`, `indeterminate`), it throws `PermanentJobError('Action receipt is already terminal', 'ACTION_RECEIPT_TERMINAL')`.
   - If the lease expired or was reclaimed by another worker (mismatched `claim_token` or `lease_until <= clock_timestamp()`), it throws `PermanentJobError('Action receipt lease was lost or expired', 'ACTION_LEASE_LOST')`.

---

## 3. Provider Capability Matrix & Safe Recovery

Remote providers exhibit asymmetrical idempotency capabilities. Reclaiming an expired lease blindly will re-dispatch non-idempotent operations.

### Provider Matrix (`PROVIDER_CAPABILITIES`)

| Provider | Mechanism | Capability | Recovery Policy on Expired Lease |
| :--- | :--- | :--- | :--- |
| **Resend** | `Idempotency-Key` HTTP header (24-hour replay window) | `verified_idempotency` | **Safe Replay:** Recovery worker reclaims with same deterministic idempotency key. |
| **SendGrid** | Standard REST API (v3/mail/send) | `no_verified_idempotency` | **Fail-Closed:** Expired lease transitions to `indeterminate` (`PROVIDER_RECOVERY_UNCERTAIN`). No blind re-dispatch. |
| **Twilio** | Standard REST API (Messages.json) | `no_verified_idempotency` | **Fail-Closed:** Expired lease transitions to `indeterminate` (`PROVIDER_RECOVERY_UNCERTAIN`). No blind re-dispatch. |
| **WhatsApp** | Cloud API (messages) | `no_verified_idempotency` | **Fail-Closed:** Expired lease transitions to `indeterminate` (`PROVIDER_RECOVERY_UNCERTAIN`). No blind re-dispatch. |
| **Zapier** | Webhook endpoint | `no_verified_idempotency` | **Fail-Closed:** Expired lease transitions to `indeterminate` (`PROVIDER_RECOVERY_UNCERTAIN`). No blind re-dispatch. |

When an unverified provider lease expires:
- `claimActionReceipt` detects `hasVerifiedIdempotency !== true`.
- Instead of returning a new claim to the recovery worker, the expired row is transitioned to `status = 'indeterminate'` with error code `PROVIDER_RECOVERY_UNCERTAIN`.
- The recovery worker halts dispatch and flags the action for human or reconciliation inspection.

---

## 4. Conservative Transport Error Classification & Abort Propagation

Network failures occurring after an HTTP request is dispatched cannot guarantee whether the remote server processed the payload.

### Classification Rules

1. **`PROVIDER_TIMEOUT_INDETERMINATE`**: Dispatched request exceeded timeout limit (10,000ms default) after socket connection was established.
2. **`PROVIDER_TRANSPORT_INDETERMINATE`**: Connection reset, socket hang up, `ECONNRESET`, `EPIPE`, or TLS termination error after transmission started.
3. **`WORKER_CANCELLED_INDETERMINATE`**: Worker execution cancelled (e.g., worker shutdown or abort signal triggered) while request was in-flight.
4. **Deterministic Non-Indeterminate Errors**:
   - Local validation failures (missing required fields, malformed URL, invalid recipient) reject before dispatch with explicit error codes (e.g., `VALIDATION_FAILED`, `ZAPIER_DISPATCH_FAILED`).
   - Definitive provider rejections (HTTP 400 Bad Request, HTTP 401 Unauthorized, HTTP 403 Forbidden) reflect definitive rejection and are marked `failed`, not `indeterminate`.

### Abort Signal Composition

Outbound requests combine the parent worker's `options.signal` with the local timeout signal using `AbortSignal.any([options.signal, timeoutSignal])`. If the worker is cancelled, the parent signal propagates immediately without being masked by local timeouts.

---

## 5. Action Identity Stabilization & Deterministic Due Dates

### Template Resolution Before Hashing

In `packages/workflow-engine/src/engine.mjs`, template interpolations (e.g. `{{contact.email}}`, `{{step.1.name}}`) are resolved on action inputs **before** passing to `createActionInvocation` and `computeActionHash`. This guarantees:
- Actions dispatched with identical template definitions produce distinct hashes if resolved values differ.
- Retries with identical resolved values produce identical hashes.

### Deterministic CRM Task Due Dates

When `dueInDays` is specified on CRM tasks without an explicit `dueDate`, the default due date is computed relative to the workflow execution's start timestamp (`execution.startedAt || execution.createdAt`), never `Date.now()`. This guarantees that retries or replays across worker restarts compute an identical target date and identical `actionHash`.

---

## 6. Runtime Governance & Zapier Security

In `workflow.action.execute` (`packages/platform-core/src/trusted-handlers.mjs`):
1. **Actor Identity Validation:** Enforces trusted actor identity (`actorId`) before sensitive dispatch. Missing or whitespace-only actor IDs fail closed with `ACTOR_IDENTITY_REQUIRED`.
2. **Approval Evidence Validation:**
   - Validates HMAC-SHA256 checksum of approval body (`APPROVAL_TAMPERED`).
   - Enforces approval expiration (`APPROVAL_EXPIRED`).
   - Enforces node/action binding (`APPROVAL_NODE_MISMATCH`).
   - Enforces **Separation of Duty**: `requestedByActorId !== approvedByActorId` (`SELF_APPROVAL_PROHIBITED`).
3. **Zapier Webhook Target Verification:**
   - Must be valid HTTPS URL (`ZAPIER_HTTPS_REQUIRED`).
   - Hostname cannot resolve to loopback, link-local, or private RFC 1918 addresses (`ZAPIER_PRIVATE_IP_BLOCKED`).
   - Outbound payload signed with HMAC-SHA256 (`x-operza-signature`).
   - Non-2xx responses throw `ZAPIER_DISPATCH_FAILED`.

---

## 7. Comprehensive 30-Scenario Regression Test Matrix

All 30 required scenarios plus 4 database security tests are implemented in `packages/platform-core/test/action-receipt-idempotency.test.mjs` and verified against real PostgreSQL:

| Scenario | Description | Result |
| :--- | :--- | :--- |
| **Scenario 1** | Worker A claims receipt with lease and receives unique claim token | **PASS** |
| **Scenario 2** | Worker A lease expires | **PASS** |
| **Scenario 3** | Worker B reclaims with new unique claim token | **PASS** |
| **Scenario 4** | Worker A attempts completion after lease expiry / reclaim -> throws `ACTION_LEASE_LOST` | **PASS** |
| **Scenario 5** | Worker A attempts failure after lease expiry / reclaim -> throws `ACTION_LEASE_LOST` | **PASS** |
| **Scenario 6** | Worker B completes successfully | **PASS** |
| **Scenario 7** | Further completion/failure attempt cannot overwrite succeeded receipt (`ACTION_RECEIPT_TERMINAL`) | **PASS** |
| **Scenario 8** | Same workerId receives distinct claim tokens across attempts | **PASS** |
| **Scenario 9** | Concurrent claims on identical action hash are serialized by database constraint | **PASS** |
| **Scenario 10** | Provider without verified idempotency: expired lease transitions to indeterminate (`PROVIDER_RECOVERY_UNCERTAIN`) | **PASS** |
| **Scenario 11** | Provider with verified idempotency (Resend): retains same stable idempotency key on retry | **PASS** |
| **Scenario 12** | Duplicate successful receipt returned without calling provider adapter | **PASS** |
| **Scenario 13** | Timeout after transmission begins -> `PROVIDER_TIMEOUT_INDETERMINATE` | **PASS** |
| **Scenario 14** | Connection reset with unknown provider acceptance -> `PROVIDER_TRANSPORT_INDETERMINATE` | **PASS** |
| **Scenario 15** | Known local validation failure -> deterministic rejection, not indeterminate | **PASS** |
| **Scenario 16** | Definitive provider rejection (401/400) classified according to policy | **PASS** |
| **Scenario 17** | Worker cancellation propagated (`WORKER_CANCELLED_INDETERMINATE`) | **PASS** |
| **Scenario 18** | Concurrent duplicate task creation results in exactly 1 task record | **PASS** |
| **Scenario 19** | Duplicate contact tag addition is idempotent and records receipt | **PASS** |
| **Scenario 20** | Opportunity stage updating idempotently records receipts | **PASS** |
| **Scenario 21** | Same CRM action produces same hash after worker restart / replay | **PASS** |
| **Scenario 22** | Task action retains default due date across retries | **PASS** |
| **Scenario 23** | Different resolved recipients produce different action hashes | **PASS** |
| **Scenario 24** | Different resolved message bodies produce different action hashes | **PASS** |
| **Scenario 25** | Repeated invocations with distinct invocationKey (e.g. loops) are distinguished | **PASS** |
| **Scenario 26** | Truthy but invalid approval evidence is rejected | **PASS** |
| **Scenario 27** | Expired approval evidence is rejected | **PASS** |
| **Scenario 28** | Approval for another node or action is rejected | **PASS** |
| **Scenario 29** | Missing trusted actor identity fails closed (`ACTOR_IDENTITY_REQUIRED`) | **PASS** |
| **Scenario 30** | Missing or revoked authoritative consent prevents provider dispatch | **PASS** |
| **DB Sec 1** | `operza_app` role is constrained to tenant scope under FORCE RLS | **PASS** |
| **DB Sec 2** | `operza_worker` role claims and completes receipts under FORCE RLS | **PASS** |
| **DB Sec 3** | Missing tenant context fails closed under RLS | **PASS** |
| **DB Sec 4** | Cross-tenant access is strictly denied under FORCE RLS | **PASS** |

---

## 8. Verification Results

| Suite | Scope | Pass | Fail | Skip | Duration |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`@operza/workflow-engine`** | AST, state machine, graph execution, action governance | 71 | 0 | 0 | 1.8s |
| **`@operza/platform-core`** | Handlers, adapters, idempotency suite, outbox producer | 159 | 0 | 1 | 42.7s |
| **`@operza/db`** | Schema migrations 001–032, RLS, repositories, test harness | 107 | 0 | 1 | ~14m |
| **`apps/api/test`** | Durable workflows, recovery, wait/resume, authority | 21 | 0 | 0 | 38.8s |
| **`scripts/verify-ci-postgres.mjs`** | End-to-end isolated PostgreSQL 16 CI pipeline | All | 0 | 0 | ~15m |

---

## 9. Remote GitHub Actions CI Notice

> **Notice Regarding Remote GitHub Actions CI:**  
> Remote GitHub Actions CI runs remain **UNVERIFIED** on GitHub infrastructure due to the organization repository account spending limit lock (`Resource not accessible by integration / billing limit`). All verification has been executed locally using dynamically allocated, isolated PostgreSQL 16 test clusters with full least-privilege role bootstrapping, migration execution (001–032), and FORCE RLS assertions.
