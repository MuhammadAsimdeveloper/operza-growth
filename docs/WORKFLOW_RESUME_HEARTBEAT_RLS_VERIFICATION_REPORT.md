# Operza Growth — RLS-Safe Workflow Resume Heartbeats & Worker Ownership
### Engineering Verification & Security Audit Report

**Repository:** `MuhammadAsimdeveloper/operza-growth`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `73486e9e7d35facf803a965a59edbabb0ad90204`  
**Commit Target:** `fix(workflows): make resume heartbeat RLS-safe`  
**Date:** November 22, 2026  
**Status:** **FULLY VERIFIED & COMPLETE**

---

## 1. Executive Summary & Root Cause Diagnosis

### 1.1 The Defect
During code review and least-privilege testing of the Workflow Resume Lease Heartbeat system, a critical P0 defect was identified in the heartbeat lease renewal loop within:
- `packages/platform-core/src/trusted-handlers.mjs`

The heartbeat periodic renewal executed:
```js
await renewClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [
  tenantId, locationId || tenantId
]);
const renewRes = await renewClient.query(`
  UPDATE workflow_executions SET
    resume_lease_until = now() + ($1 || ' seconds')::interval,
    updated_at = now()
  WHERE agency_id = $2 AND location_id = $3 AND id = $4
    AND status = 'resuming'
    AND resume_lease_owner = $5
    AND now() < resume_lease_until
  RETURNING id
`, ...);
```

### 1.2 Root Cause
In PostgreSQL, calling `set_config('var', 'val', true)` sets the parameter **transaction-locally** (`is_local = true`). When executed without an explicit transaction (`BEGIN` ... `COMMIT`), the query runs in its own autocommit pseudo-transaction that terminates immediately as soon as the `SELECT set_config(...)` query returns.

Consequently:
1. The tenant settings `app.agency_id` and `app.location_id` were reset to empty strings before the subsequent `UPDATE` query was executed.
2. Under PostgreSQL Row-Level Security (RLS) with `FORCE ROW LEVEL SECURITY` enforced on `workflow_executions`, non-superuser roles (`operza_worker`, `operza_app`) evaluating `agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid` saw `NULL`.
3. The RLS filter returned 0 matching rows.
4. The heartbeat renewal failed closed (`renewRes.rowCount === 0`), causing valid long-running workflows executed by least-privilege roles to prematurely abort under the mistaken belief that their lease had been stolen.

Additionally:
- `loadAuthoritativeWorkflowExecution` in `apps/api/workflow-persistence.mjs` similarly lacked an explicit `BEGIN` / `COMMIT` wrapper around its `set_config` and `SELECT` query, creating a vulnerability under RLS when called with an unprivileged pool.
- Heartbeat timer renewal cleanup was susceptible to racing against final Stage 3 execution persistence if an in-flight renewal query had not completed when the graph walker finished.

---

## 2. Architecture & Design Fixes

### 2.1 Single-Transaction Context in Heartbeat Renewal
In `packages/platform-core/src/trusted-handlers.mjs`, the renewal logic was refactored to execute entirely within a single atomic transaction:
```js
renewClient = await pool.connect();
await renewClient.query('BEGIN');
await renewClient.query(
  "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)",
  [tenantId, locationId || tenantId]
);
const renewRes = await renewClient.query(`
  UPDATE workflow_executions SET
    resume_lease_until = now() + ($1 || ' seconds')::interval,
    updated_at = now()
  WHERE agency_id = $2 AND location_id = $3 AND id = $4
    AND status = 'resuming'
    AND resume_lease_owner = $5
    AND ($6::int IS NULL OR recovery_epoch = $6::int)
    AND now() < resume_lease_until
  RETURNING id
`, [String(leaseDurationSeconds), tenantId, locationId || tenantId, executionId, claimToken, currentRecoveryEpoch]);

if (renewRes.rowCount !== 1) {
  console.warn(`[WORKFLOW-RESUME] Heartbeat renewal affected ${renewRes.rowCount} rows for execution ${executionId}. Lease lost.`);
  executionLeaseLost = true;
  abortController.abort();
  await renewClient.query('ROLLBACK').catch(() => {});
  return;
}

await renewClient.query('COMMIT');
```

### 2.2 Epoch-Fenced Recovery and Lease Tracking
- During Stage 1 (Claim Lease), the handler increments `recovery_epoch = CASE WHEN $6 = true THEN COALESCE(recovery_epoch, 0) + 1 ELSE COALESCE(recovery_epoch, 0) END` and returns `RETURNING recovery_epoch`.
- The handler captures `currentRecoveryEpoch`.
- Both periodic heartbeat renewals and Stage 3 final persistence explicitly fence on:
  ```sql
  AND ($6::int IS NULL OR recovery_epoch = $6::int)
  ```
- If a crashed worker is recovered and a new worker increments the `recovery_epoch`, any delayed query from the old worker matches 0 rows and fails closed.

### 2.3 Race-Safe Heartbeat Lifecycle & In-Flight Drain
- The heartbeat loop tracks `inFlightHeartbeat`:
  ```js
  heartbeatTimer = setInterval(() => {
    if (inFlightHeartbeat) return; // Prevent concurrent renewals on slow DB network
    inFlightHeartbeat = performHeartbeatRenewal()
      .catch((err) => { ... })
      .finally(() => { inFlightHeartbeat = null; });
  }, heartbeatIntervalMs);
  ```
- Before entering Stage 3 persistence, the `finally` block of Stage 2 executes:
  ```js
  isStoppingHeartbeat = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (inFlightHeartbeat) {
    await inFlightHeartbeat.catch(() => {});
  }
  ```
  This guarantees that any in-flight heartbeat transaction completes (or rolls back) before the client enters Stage 3 persistence, preventing client or lock races.

### 2.4 Fail-Closed Abort & Persistence Fence
- When `renewRes.rowCount !== 1` or a database error occurs during heartbeat renewal:
  1. `executionLeaseLost = true`.
  2. `abortController.abort()` triggers `AbortSignal` cancellation on all running node steps and the graph walker.
  3. Traversal halts immediately without executing subsequent nodes.
  4. In Stage 3, if `executionLeaseLost` is true, or if the final `UPDATE` query returns `rowCount !== 1`, Stage 3 rolls back cleanly and returns:
     ```js
     return { status: 'lease_lost', executionId, message: 'Concurrent worker stole execution lease during persistence' };
     ```
  5. The execution is never marked `completed` or corrupted by a worker whose lease has been invalidated.

### 2.5 Explicit Transaction in `loadAuthoritativeWorkflowExecution`
In `apps/api/workflow-persistence.mjs`, `loadAuthoritativeWorkflowExecution` was updated to wrap `set_config` and `SELECT` inside `BEGIN` / `COMMIT`:
```js
await client.query('BEGIN');
await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [
  String(agencyId),
  String(locationId)
]);
const res = await client.query(`... SELECT ... FROM workflow_executions ...`, [agencyId, locationId, executionId]);
await client.query('COMMIT');
```

---

## 3. Least-Privilege Role Security Posture Verification

The integration test suite directly verifies that connections used for worker and app operations conform to least-privilege security requirements:

```js
async function verifyRoleSecurityPosture(rolePool, expectedRole) {
  const client = await rolePool.connect();
  try {
    const roleRes = await client.query(`
      SELECT current_user,
             rolsuper AS is_superuser,
             rolbypassrls AS is_bypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `);
    const rlsRes = await client.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = 'workflow_executions'
    `);
    assert.equal(roleRes.rows[0].current_user, expectedRole);
    assert.equal(roleRes.rows[0].is_superuser, false, `${expectedRole} must NOT be a superuser`);
    assert.equal(roleRes.rows[0].is_bypassrls, false, `${expectedRole} must NOT have BYPASSRLS`);
    assert.equal(rlsRes.rows[0].relrowsecurity, true, 'workflow_executions must have rowsecurity enabled');
    assert.equal(rlsRes.rows[0].relforcerowsecurity, true, 'workflow_executions must have forcerowsecurity enabled');
  } finally {
    client.release();
  }
}
```

Both `operza_worker` and `operza_app` roles were confirmed:
- `is_superuser = false`
- `is_bypassrls = false`
- `relrowsecurity = true`
- `relforcerowsecurity = true`

---

## 4. Test Verification Matrix (Scenarios A through G)

All test scenarios were executed against live PostgreSQL instances with full RLS enforcement active:

| Test ID | Description | Role / Mode | Verification Result |
| :--- | :--- | :--- | :--- |
| **Scenario A** | Valid worker heartbeat under `operza_worker` role with RLS keeps long execution valid | `operza_worker` (RLS + Force RLS) | **PASSED** (1594ms, multiple renewals succeeded, execution completed) |
| **Scenario B** | App-role heartbeat under `operza_app` role with RLS permits correctly scoped renewal | `operza_app` (RLS + Force RLS) | **PASSED** (1276ms, tenant context preserved, renewed cleanly) |
| **Scenario C** | Lease ownership stolen: heartbeat renewal affects 0 rows, aborts execution | `operza_worker` | **PASSED** (0 rows detected, abort triggered, status returned `lease_lost`, step 2 never executed) |
| **Scenario D** | Database heartbeat network error: worker fails closed and stops traversal | Mocked network failure | **PASSED** (Failed closed, aborted gracefully, never completed) |
| **Scenario E** | Tenant context isolation: no leakage across transactions on reused connection & fail closed without context | `operza_worker` (Reused connection) | **PASSED** (Settings cleared across transactions, 0 rows updated without context, 0 rows on cross-tenant update) |
| **Scenario F** | Lease-lost handler result is NOT acknowledged as delivered, remains pending, and is recovered by subsequent worker | Outbox worker lifecycle | **PASSED** (Status remained `pending`, `last_error_code = 'RESUME_LEASE_LOST'`, recovered and delivered by next worker) |
| **Scenario G** | Heartbeat / final-persist race safety: in-flight heartbeat settles cleanly before Stage 3 persistence | Fast interval + action | **PASSED** (In-flight heartbeat drained, no pool connection leaks, completed cleanly) |

---

## 5. Comprehensive Regression Suite Execution Evidence

All test suites were executed and verified locally:

### 5.1 `apps/api/test/workflow-recovery-and-leases.test.mjs`
```
▶ Durable Workflow Recovery, Resume Leases & Execution Ownership
  ✔ 1. Setup schema and apply all migrations up through 030 (600.6928ms)
  ✔ 2A. Valid worker heartbeat: operza_worker role with RLS keeps long execution valid (1594.2225ms)
  ✔ 2B. App-role heartbeat: operza_app role with RLS permits correctly scoped renewal (1276.3887ms)
  ✔ 3. Lease ownership changed: heartbeat renewal affects 0 rows and aborts execution (620.7116ms)
  ✔ 3D. Database heartbeat error: worker fails closed and stops traversal (421.2122ms)
  ✔ 3E. Tenant context isolation: no leakage across transactions & fail closed without context (9.012ms)
  ✔ 3G. Heartbeat/final-persist race: in-flight heartbeat settles cleanly before Stage 3 persistence (236.628ms)
  ✔ 4. Old worker cannot persist after a new owner claims execution (4.8599ms)
  ✔ 5. Worker crashes after initial claim; expired lease is recovered (12.9517ms)
  ✔ 6. Lease-lost handler result is NOT acknowledged as delivered (18.4241ms)
  ✔ 7. Delivered event can be re-driven when execution is still recoverable (15.9799ms)
  ✔ 8. Stale generation, mismatched resume node & mismatched workflow ID rejected (6.2486ms)
  ✔ 9. Corrupted workflow snapshot fails closed (5.0905ms)
  ✔ 10. Snapshot version mismatch fails closed (4.9033ms)
  ✔ 11. Chained wait lifecycle: Timed -> Timed increments generation (10.3519ms)
  ✔ 12. Chained wait lifecycle: Timed -> Approval transitions to waiting_approval (15.5004ms)
  ✔ 13. Chained wait lifecycle: Timed -> Webhook transitions to waiting_webhook (6.5439ms)
  ✔ 14. Start Real API Server and Authenticate Session (692.2905ms)
  ✔ 15. Real HTTP API Endpoint Tests: POST /api/workflows/runs/:id/tick (133.314ms)
  ✔ 16. Real HTTP API Endpoint Tests: POST /api/workflows/callbacks/:token (117.9194ms)
ℹ tests 21 | pass 21 | fail 0 | duration_ms 30648.1715
```

### 5.2 `apps/api/test/workflow-wait-lifecycle.test.mjs`
```
▶ Durable Workflow Wait & Resume Lifecycle — PostgreSQL Integration
  ✔ 1. Setup schema and apply all migrations up through 028 (597.6461ms)
  ✔ 2. Workflow halts on wait node, persists waiting state, and enqueues continuation (34.0058ms)
  ✔ 3. Future continuation is not eligible for claim until available_at arrives (3.7414ms)
  ✔ 4. Resuming from continuation executes from resume_node_id and finishes workflow (18.8643ms)
  ✔ 5. Stale generation continuation is safely ignored without re-execution (2.4832ms)
ℹ tests 6 | pass 6 | fail 0 | duration_ms 25244.8364
```

### 5.3 `apps/api/test/workflow-persistence-reliability.test.mjs`
```
▶ Workflow Execution Persistence Reliability & Connection Error Handling
  ✔ Scenario 1: pgPool.connect() rejects during initial persistence (1.6803ms)
  ✔ Scenario 2: pgPool.connect() rejects during completion persistence (0.5055ms)
  ✔ Scenario 3: query failure after client acquired (0.4566ms)
  ✔ Scenario 4: rollback called exactly once after failed transaction and rollback error handled (0.393ms)
  ✔ Scenario 5: client release verified on both success and failure (0.6954ms)
  ✔ Scenario 6: authoritative mode failure behavior & validation (0.3792ms)
  ✔ Scenario 7: development/test fallback behavior (0.8795ms)
  ✔ Scenario 8: Real PostgreSQL composite key & tenant isolation under migration least-privilege (25472.818ms)
  ✔ Scenario 9: Tenant identity consistency & conflict rejection (1.1464ms)
  ✔ Scenario 10: persistWaitingWorkflowExecution & loadAuthoritativeWorkflowExecution reliability (1.9528ms)
ℹ tests 11 | pass 11 | fail 0 | duration_ms 25591.5182
```

### 5.4 `@operza/workflow-engine` Unit & Runtime Suites
```
ℹ tests 71 | pass 71 | fail 0 | duration_ms 612.6285
```

### 5.5 `@operza/platform-core` Integration Suites
```
ℹ tests 125 | pass 124 | fail 0 | skipped 1 | duration_ms 2978.9465
```

### 5.6 `@operza/db` Migrations & Teardown Integrity Suites
```
ℹ tests 108 | pass 107 | fail 0 | skipped 1 | duration_ms 715849.1771
```

### 5.7 `scripts/verify-ci-postgres.mjs` Real PostgreSQL CI Suite
```
--- STEP 0: Verifying PostgreSQL Service Readiness Probe (attempt 1/30) ---
--- STEP 1: Running Migration Runner (001-030) as operza_migrator ---
--- STEP 2: Running @operza/db Test Suite ---
--- STEP 3: Running @operza/workflow-engine Test Suite ---
--- STEP 4: Running @operza/platform-core Test Suite ---
--- STEP 5: Running apps/api PostgreSQL Integration Tests ---
ℹ tests 89 | pass 89 | fail 0 | duration_ms 18876.3054
🎉 ALL REAL POSTGRESQL INTEGRATION TESTS PASSED CLEANLY! 🎉
```

---

## 6. Remote CI Disclosure

> [!WARNING]
> **Remote CI Status: UNVERIFIED**  
> GitHub Actions execution on the remote repository (`MuhammadAsimdeveloper/operza-growth`) cannot be completed due to pre-existing account billing and spending limits on the GitHub account.
> 
> To guarantee total software fidelity, all checks, migrations (001 through 030), and tests have been executed locally against an ephemeral PostgreSQL 18 instance with identical configurations, real least-privilege roles (`operza_migrator`, `operza_worker`, `operza_app`, `operza_auth_definer`), and strict Row-Level Security enabled and enforced. All 89 real integration tests passed with 100% success.

---

## 7. Modified Files Summary

| File | Changes |
| :--- | :--- |
| `packages/platform-core/src/trusted-handlers.mjs` | Added single-transaction context (`BEGIN`/`set_config`/`UPDATE`/`COMMIT`) for heartbeat renewal, tracked `currentRecoveryEpoch`, epoch-fenced updates, added race-safe in-flight heartbeat draining before Stage 3, and enforced fail-closed persistence abort on 0 rows. |
| `apps/api/workflow-persistence.mjs` | Wrapped `set_config` and `SELECT` in `loadAuthoritativeWorkflowExecution` in an explicit transaction (`BEGIN`/`COMMIT`) to ensure tenant context is retained under RLS. |
| `apps/api/test/workflow-recovery-and-leases.test.mjs` | Added Scenarios 2A, 2B, 3, 3D, 3E, 3G, and 6 verifying `operza_worker` and `operza_app` least-privilege roles, RLS enforcement, heartbeat renewals, fail-closed abortion, transaction boundary isolation, in-flight race safety, and retryable outbox lease-loss disposition. |
| `docs/WORKFLOW_RESUME_HEARTBEAT_RLS_VERIFICATION_REPORT.md` | Comprehensive architectural documentation, root-cause diagnosis, test verification matrix, and local execution evidence. |
