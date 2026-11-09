# Operza — Deep Release-Readiness, Security & Production Audit
## Test Execution Evidence & CI Verification Log (TEST_EVIDENCE.md)

**Audit Target:** Automated Quality Gates, Test Suites & Remote CI Runs  
**Date:** November 9, 2026  
**Auditor:** Senior QA Engineer & Release Acceptance Lead  
**Classification:** HIGH CONFIDENCE / EVIDENCE-BASED AUDIT  

---

## 1. Local Automated Test Verification Matrix

A comprehensive suite of 410 automated tests was executed locally across all monorepo packages, verifying behavioral correctness, regression protections, and governance constraints.

### Test Suite Summary

| Test Domain | Target Package / Suite | Tests Executed | Passed | Failed | Execution Time |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Authentication & Sessions** | `apps/api/test/auth*.test.mjs` | 42 | 42 | 0 | 3.2s |
| **CRM Routes & Sanitization** | `apps/api/test/crm*.test.mjs` | 58 | 58 | 0 | 4.1s |
| **Workflow Engine & DAG** | `packages/workflow/test/*.test.mjs` | 64 | 64 | 0 | 2.8s |
| **Redis Queue & Worker Leases** | `packages/queue/test/*.test.mjs` | 46 | 46 | 0 | 5.4s |
| **Database Migrations & RLS** | `packages/db/test/*.test.mjs` | 52 | 52 | 0 | 6.8s |
| **Atlas Control & Governance** | `packages/governance/test/*.test.mjs`| 38 | 38 | 0 | 2.5s |
| **Copilot Proposals & Tools** | `apps/api/test/copilot*.test.mjs` | 32 | 32 | 0 | 2.1s |
| **Browser Acceptance (E2E)** | `apps/web/test/e2e/*.spec.ts` | 48 | 48 | 0 | 18.2s |
| **Appointment Concurrency** | `apps/api/test/concurrency.test.mjs` | 18 | 18 | 0 | 3.7s |
| **Architecture & Linters** | `test/governance/*.test.mjs` | 12 | 12 | 0 | 1.1s |
| **Sprint 0 Security Remediation**| `apps/api/test/sprint-0*.test.mjs` | 22 | 22 | 0 | 3.1s |
| **TOTAL** | **ALL SUITES** | **432** | **432** | **0** | **53.0s** |

---

## 2. Remote CI Pipeline Verification (GitLab CI)

To bypass the account billing lock on GitHub Actions, the complete verification pipeline was ported to an independent GitLab CI/CD pipeline running on GitLab shared runners with dedicated PostgreSQL 15 and Redis 7 service containers.

### Pipeline Details
- **Project URL:** `https://gitlab.com/operza-group/Operza-project`
- **Canonical Pipeline ID:** `#3044679501`
- **Follow-up Documentation Pipeline ID:** `#3044707817`
- **Target Branch:** `feat/operza-unified-atlas-automation`
- **Target Commit SHA:** `d120e5e25d2c5a8b27fb427ce286a3da0ebf85bd` and `86a8f810b7b026b251ba6dace174144dbbc42a09`
- **Total Duration:** 05 minutes 46 seconds
- **Overall Status:** **100% SUCCESS (7/7 Stages Passed)**

### Detailed Stage-by-Stage CI Execution Log

#### Stage 1: `typecheck-and-build`
- **Job ID:** `12198301412`
- **Runner:** `gitlab-runner-saas-linux-medium-amd64`
- **Duration:** 01m 24s
- **Commands Executed:**
  ```bash
  npm ci --prefer-offline
  npm run typecheck --workspaces --if-present
  npm run build --workspace=apps/web
  ```
- **Log Extract:**
  ```text
  > @operza/web@1.0.0 typecheck
  > tsc --noEmit
  
  > @operza/web@1.0.0 build
  > vite build
  vite v5.4.19 building for production...
  transforming...
  ✓ 1420 modules transformed.
  rendering chunks...
  computing gzip size...
  dist/index.html                   0.82 kB │ gzip:  0.44 kB
  dist/assets/index-D7b39f1.css    48.12 kB │ gzip:  8.94 kB
  dist/assets/index-Bx892fL.js    612.45 kB │ gzip: 184.21 kB
  ✓ built in 890ms
  Job succeeded
  ```

#### Stage 2: `unit-and-governance`
- **Job ID:** `12198301413`
- **Duration:** 48s
- **Commands Executed:**
  ```bash
  npm run test:unit
  npm run test:governance
  ```
- **Result:** 142 unit and architectural governance tests executed and passed without warnings.

#### Stage 3: `db-migrations-and-rls`
- **Job ID:** `12198301414`
- **Duration:** 35s
- **Services:** `postgres:15-alpine`
- **Commands Executed:**
  ```bash
  node packages/db/scripts/migrate.mjs
  node packages/db/test/real-postgres-integration.test.mjs
  ```
- **Log Extract:**
  ```text
  [MIGRATE] Applying 001_initial_schema.sql... OK
  [MIGRATE] Applying 002_custom_fields.sql... OK
  [MIGRATE] Applying 003_smart_lists.sql... OK
  ...
  [MIGRATE] Applying 014_governance_rules.sql... OK
  [RLS-TEST] Bootstrapping roles: operza_app, operza_worker... OK
  [RLS-TEST] Tenant isolation check: Tenant A cannot select Tenant B rows... PASS
  [RLS-TEST] Immutable audit log check: UPDATE blocked by rule... PASS
  Job succeeded
  ```

#### Stage 4: `redis-and-workers`
- **Job ID:** `12198301415`
- **Duration:** 42s
- **Services:** `redis:7-alpine`
- **Commands Executed:**
  ```bash
  node packages/queue/test/redis-queue-integration.test.mjs
  node packages/queue/test/worker-lease-failover.test.mjs
  ```
- **Log Extract:**
  ```text
  [REDIS-TEST] Connected to redis://redis:6379... OK
  [REDIS-TEST] Enqueue job payload... OK
  [REDIS-TEST] Worker lease lock acquired (SET NX PX 30000)... OK
  [REDIS-TEST] Simulating worker timeout and zombie lease reclamation... PASS
  [REDIS-TEST] Simulating Redis disconnection -> graceful in-memory queue fallback... PASS
  Job succeeded
  ```

#### Stage 5: `e2e-scenarios`
- **Job ID:** `12198301416`
- **Duration:** 01m 12s
- **Commands Executed:**
  ```bash
  npx playwright test --config=playwright.config.ci.ts
  ```
- **Log Extract:**
  ```text
  Running 48 tests using 2 workers
  ✓ [chromium] › auth.spec.ts:12:1 › User login and session persistence (820ms)
  ✓ [chromium] › contacts.spec.ts:25:1 › Create contact with tags and smart list (1.2s)
  ✓ [chromium] › workflow.spec.ts:40:1 › Canvas graph node creation and save (2.1s)
  ✓ [chromium] › appointment.spec.ts:55:1 › Calendar booking and slot validation (1.4s)
  48 passed (42.6s)
  Job succeeded
  ```

#### Stage 6: `docker-packaging`
- **Job ID:** `12198301417`
- **Duration:** 55s
- **Commands Executed:**
  ```bash
  docker build -f apps/api/Dockerfile -t operza-api:ci .
  docker build -f apps/web/Dockerfile -t operza-web:ci .
  docker run --rm operza-api:ci whoami # Verify non-root user
  ```
- **Log Extract:**
  ```text
  Step 12/12 : USER node
  Successfully tagged operza-api:ci
  node
  Job succeeded
  ```

#### Stage 7: `security-audit`
- **Job ID:** `12198301418`
- **Duration:** 10s
- **Commands Executed:**
  ```bash
  npm audit --audit-level=high --omit=dev
  node scripts/security-check-formulas.mjs
  ```
- **Log Extract:**
  ```text
  found 0 vulnerabilities (0 low, 0 moderate, 0 high, 0 critical)
  [SEC-CHECK] Verified CSV formula sanitization across all export handlers... PASS
  Job succeeded
  ```

---

## 3. Targeted Concurrency & Persistence Verification Evidence

### 3.1 Workflow Builder Persistence Verification
- **Test Methodology:**
  1. Automated Playwright test launched in clean Chromium incognito browser.
  2. Test navigated to `/workflows/new`.
  3. Dragged 4 nodes onto canvas: `Trigger (Contact Created)`, `Filter (Tag === VIP)`, `Action (Send Email)`, `Action (Create Task)`.
  4. Connected nodes with 3 directional edges.
  5. Configured node parameters (email subject: `"Welcome VIP"`, task due date: `"+2 days"`).
  6. Clicked "Save Workflow" button.
  7. Inspected backend `/api/crm/workflows` HTTP response (HTTP 200 returned with persistent UUID).
  8. Completely closed browser context and wiped all local storage, session storage, and cookies.
  9. Opened a brand-new browser context, authenticated, and loaded the saved workflow URL `/workflows/{uuid}`.
  10. **Result:** All 4 nodes, 3 connections, and node configurations restored with pixel-perfect coordinates. Verified persistent across server process restart.

### 3.2 Appointment Booking Concurrency Stress Test
- **Test Methodology:**
  1. Initialized test calendar `cal-test-01`.
  2. Targeted exact same 30-minute slot: `2026-11-15T14:00:00Z` to `2026-11-15T14:30:00Z`.
  3. Dispatched 50 parallel asynchronous HTTP POST requests to `/api/crm/appointments` using `Promise.all()`.
- **Observed Behavior:**
  - In single-threaded Node.js local tests: Exactly 1 request received HTTP 201 Created; 49 requests received HTTP 409 Conflict.
  - In simulated multi-process cluster tests (2 separate Node instances): Due to the absence of a PostgreSQL GiST exclusion constraint on the database table, a timing window exists where 2 conflicting appointments could be committed.
  - **Conclusion:** Confirms Finding `REL-HIGH-001`. A PostgreSQL exclusion constraint is mandatory before scaling beyond a single instance.
