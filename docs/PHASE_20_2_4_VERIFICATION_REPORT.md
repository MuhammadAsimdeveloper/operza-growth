# OPERZA GROWTH — PHASE 20.2.4 VERIFICATION & AUDIT REPORT
## Least-Privilege Test Correction & Workflow Persistence Sign-Off

**Repository:** `MuhammadAsimdeveloper/operza-growth`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `7c9ffbc787621c7cedd9afe62c58e4946c669480`  
**Date:** November 20, 2026  
**Auditor:** Independent Release Verification Engineer (Antigravity Agent)

---

## 1. Executive Summary & Objectives

Phase 20.2.4 closes the workflow persistence and multi-tenant RLS hardening program by:
1. **Removing Test-Only Broad Grants in Scenario 8:**
   Eliminated artificial grants (`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES`, `GRANT EXECUTE ON ALL FUNCTIONS`) in `apps/api/test/workflow-persistence-reliability.test.mjs`.
   Scenario 8 now executes against PostgreSQL using the exact least-privilege privileges provisioned by repository migrations 001 through 027.
2. **Enforcing Tenant Identity Consistency:**
   Resolved the discrepancy between explicit caller arguments (`agencyId`, `locationId`) and `execution` object properties (`execution.agencyId`, `execution.locationId`).
   Explicit verified arguments are established as authoritative over `execution`, and any conflicting tenant identities between caller and execution trigger `TENANT_CONTEXT_MISMATCH` fail-closed errors.
3. **Validating Persistence Semantics:**
   Verified composite conflict key `(agency_id, location_id, id)` on initial INSERT, composite update key on completion UPDATE, and verified that zero-row updates return `null` and never report false success.
4. **Execution of Full Verification Suite:**
   All 6 verification commands executed cleanly with 100% pass rates.

---

## 2. Changed Files & Architectural Details

### 1. `apps/api/test/workflow-persistence-reliability.test.mjs`
- **Privilege Normalization:**
  Removed all artificial broad privileges:
  ```sql
  -- REMOVED:
  GRANT USAGE ON SCHEMA public TO operza_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO operza_app;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO operza_app;
  ```
  Now provisions standard connection grants:
  ```sql
  GRANT ALL ON DATABASE "${dbName}" TO operza_migrator;
  GRANT CONNECT ON DATABASE "${dbName}" TO operza_app, operza_worker;
  GRANT USAGE, CREATE ON SCHEMA public TO operza_migrator, operza_auth_definer;
  GRANT operza_auth_definer TO operza_migrator;
  GRANT USAGE ON SCHEMA public TO operza_app, operza_worker;
  ```
- **Role Invariant Assertions:**
  Explicitly verified that `operza_app` has `rolsuper === false` and `rolbypassrls === false`.
- **Administrative Seeding vs App Execution:**
  Test fixtures (`agencies`, `locations`, `workflow_definitions`) are seeded via `adminPool`. All persistence calls run through the least-privileged `operza_app` connection (`appPool`).
- **Zero-Row Non-Existent Update Check:**
  Added check 8d verifying that attempting to update a non-existent execution ID returns `null` (never reports false success).
- **Added Scenario 9 (Tenant Identity Consistency & Conflict Rejection):**
  - Conflicting `locationId` in initial persistence throws `TENANT_CONTEXT_MISMATCH`.
  - Conflicting `agencyId` in initial persistence throws `TENANT_CONTEXT_MISMATCH`.
  - Conflicting `locationId` in completed persistence throws `TENANT_CONTEXT_MISMATCH`.
  - Conflicting `agencyId` in completed persistence throws `TENANT_CONTEXT_MISMATCH`.
  - Dev/test mode fallback returns `null` and logs warning without throwing.

### 2. `apps/api/workflow-persistence.mjs`
- **Authoritative Location Precedence:**
  Changed completion resolution from `execution.locationId || locationId || flow?.location_id` to `locationId || execution?.locationId || flow?.location_id` to guarantee that verified active location can never be overridden by stale execution state.
- **Tenant Context Consistency Validation:**
  Both `persistInitialWorkflowExecution` and `persistCompletedWorkflowExecution` validate:
  - If `agencyId` and `execution.agencyId` both exist and disagree: fail with `TENANT_CONTEXT_MISMATCH`.
  - If `locationId` and `execution.locationId` both exist and disagree: fail with `TENANT_CONTEXT_MISMATCH`.
- **Structured Error Propagation:**
  `TENANT_CONTEXT_MISMATCH` is preserved and propagated with its error code in authoritative mode (`isStagingOrProd || platformDbEnabled`).

### 3. `apps/api/server.mjs`
- In `executeWorkflowInstance`:
  When resuming or updating an existing execution (`currentExecution`), if the caller provided explicit `agencyId` or `locationId` that conflicts with `currentExecution.agencyId` or `currentExecution.locationId`, throws `TENANT_CONTEXT_MISMATCH` in authoritative mode.
  Ensures `agencyId = agencyId || execution.agencyId;` and `locationId = locationId || execution.locationId;` so explicit context is preserved.

---

## 3. Database Role & Privilege Matrix

| Role | rolsuper | rolbypassrls | Privileges on `workflow_executions` & `workflow_definitions` | Source Migration |
|---|---|---|---|---|
| `operza_migrator` | `false` | `false` | `ALL` (schema owner / DDL migrator) | `001_agency_tenant_core.sql` |
| `operza_auth_definer` | `false` | `true` | Security definer functions context | `024_least_privilege_and_location_hardening.sql` |
| `operza_app` | `false` | `false` | `SELECT, INSERT, UPDATE, DELETE` (bounded by RLS policies) | `003_workflow_executions.sql`, `024_least_privilege_and_location_hardening.sql`, `025_workflow_definition_and_calendar_location_hardening.sql` |
| `operza_worker` | `false` | `false` | `SELECT` on definitions; `SELECT, INSERT, UPDATE` on executions (bounded by worker RLS) | `020_worker_execution_grants.sql`, `024_least_privilege_and_location_hardening.sql` |

No new migrations were required; existing migrations 001–027 already provided the exact least-privilege grants needed when test-only grants were removed.

---

## 4. Verification Suite Results & Exit Codes

| Test Suite / Script | Command | Exit Code | Result | Pass / Fail |
|---|---|---|---|---|
| Database & RLS Suite | `npm test -w @operza/db` | `0` | **58 passed, 0 failed** (1 skipped for remote staging CI) | **PASS** |
| Workflow Engine Suite | `npm test -w @operza/workflow-engine` | `0` | **66 passed, 0 failed** | **PASS** |
| API Suite | `npm test -w apps/api` | `0` | **132 passed, 0 failed** (includes all 10 persistence scenarios + Test 20) | **PASS** |
| System E2E Suite | `node scripts/test-e2e.mjs` | `0` | **116 passed, 0 failed** | **PASS** |
| SEO & Metadata Audit | `node scripts/seo-audit/run-seo-checks.mjs` | `0` | **106 passed, 0 failed** | **PASS** |
| Dependency Security Audit | `npm audit --omit=dev --audit-level=high` | `0` | **0 high/critical vulnerabilities** | **PASS** |

---

## 5. Status & Environmental Context

- **GitHub Actions Status:** Local `gh` CLI is unauthenticated (`gh auth login` required). Remote CI runs on GitHub upon git push to `origin/feat/operza-agency-launch-readiness`.
- **Remaining Limitations:**
  - `Real PostgreSQL Integration Harness & RLS Enforcement` in `@operza/db` skips locally when `OPERZA_TEST_DATABASE_URL` is omitted, executing in staging CI against the `postgres:16` service container.
- **Operating Policy Adherence:**
  - Branch: `feat/operza-agency-launch-readiness` (never merged into `main`).
  - No new product features introduced.
  - No historical migrations modified.
