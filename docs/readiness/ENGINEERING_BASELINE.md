# Operza Growth — Engineering Baseline & Discovery Report

**Starting Commit SHA:** `104317fe7abb581fbe2a4cf9d9bc8fd783741cba`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Repository Remote:** `https://github.com/MuhammadAsimdeveloper/operza-growth.git`  
**Date of Audit:** November 19, 2026  
**Audit Lead:** Principal Software Architect & Application Security Engineer

---

## 1. Repository & Workspace Architecture

The Operza Growth repository is organized as an npm workspace monorepo (`package.json` root workspace configuration):

```
operza-growth/
├── apps/
│   ├── api/                 # Node.js HTTP/WebSocket API server & durable worker process
│   └── web/                 # React 19 + TypeScript + Vite frontend client application
├── packages/
│   ├── action-governance/   # ReDoS, AST, prototype pollution & schema validation engine
│   ├── db/                  # PostgreSQL migrations (001-022), connection pool & outbox repo
│   ├── platform-core/       # Outbox engine, provider adapters, consent & encryption vault
│   ├── shared/              # Shared types, constants, utilities
│   └── workflow-engine/     # Graph walker, expression engine, step execution & approval gates
├── docs/                    # Architectural decisions, threat models, guides & audit logs
└── scripts/                 # Development, CI/CD, E2E and SEO validation scripts
```

### Dependencies & Engines
- **Node.js:** `>=20.0.0` (validated against Node 20.x and Node 22.x)
- **Database Engine:** PostgreSQL 16 (relational authority, FORCE RLS, GiST interval exclusion constraints)
- **Queue/Worker:** Dual-layer — PostgreSQL transactional `workflow_outbox` (authoritative) + optional Redis 7 queue for caching/pubsub.

---

## 2. PostgreSQL Migrations Inventory (001–022)

| Migration | Title / Purpose | RLS Status | Security Assessment |
| :--- | :--- | :---: | :--- |
| `001_agency_tenant_core.sql` | Tenant core: agencies, users, memberships, locations, sessions | FORCE RLS | Strict tenant-bound policies on data; auth_sessions un-scoped |
| `002_public_form_registry.sql` | Public forms & submissions registry | Partial | Public submissions allowed |
| `003_workflow_executions.sql` | Workflow definitions & execution traces | FORCE RLS | Strict tenant scope enforced on definitions and executions |
| `004_workflow_templates.sql` | Reusable workflow templates | System | Read-only global templates |
| `005_agency_snapshots.sql` | Snapshot backups of agency configuration | FORCE RLS | Agency-scoped |
| `006_ecosystem_and_telephony.sql` | Phone numbers, SMS/voice logs, webhooks | FORCE RLS | Agency/location scoped |
| `007_workflow_step_simulation_status.sql` | Step simulation flags | System | Schema update |
| `008_platform_foundation.sql` | Entitlements, usage, outbox, receipts, consent | FORCE RLS | Tenant-scoped outbox & receipts; worker bypass introduced |
| `009_copilot_proposals.sql` | AI Copilot action proposals | FORCE RLS | Strictly tenant-scoped |
| `010_zapier_and_agent_suite.sql` | Zapier rest hooks & agent suite | FORCE RLS | Tenant-scoped subscriptions |
| `011_platform_reconciliation.sql` | CRM entities: pipelines, stages, calendars, appts | FORCE RLS | Strict composite key scoping (`agency_id`, `location_id`) |
| `012_durable_workflow_leases.sql` | Worker leases & queue indexes on executions | Indexes | Worker lease locking |
| `013_transactional_billing_ledger.sql` | Immutable ledger accounts and credit entries | FORCE RLS | Strict tenant isolation |
| `014_immutable_audit_events.sql` | Append-only audit logs with tamper check | FORCE RLS | No update/delete permitted |
| `015_appointment_concurrency_exclusion.sql` | GiST exclusion constraint on appointments | Constraint | Prevents overlapping booking slots at engine level |
| `016_provider_secret_vault.sql` | AES-256-GCM encrypted provider credentials | FORCE RLS | Tenant-bound secret refs |
| `017_provider_oauth_states.sql` | Single-use PKCE OAuth state repository | FORCE RLS | Tenant-bound OAuth states |
| `018_durable_zapier_hooks.sql` | Zapier webhook delivery outbox | FORCE RLS | Tenant-scoped deliveries |
| `019_worker_heartbeats.sql` | Cluster worker process heartbeats | Global | System worker registration |
| `020_worker_execution_grants.sql` | Grants for `operza_worker` | **Defective** | **VULNERABILITY: Grants `USING (true)` cross-tenant access** |
| `021_appointment_external_event_id.sql` | External calendar event ID tracking | Schema | Adds `external_event_id` column |
| `022_tenant_rls_and_worker_consent.sql` | Application role grants and worker consent | **Defective** | **VULNERABILITY: Permissive `USING (true)` read policies on core tables** |

---

## 3. Discovered Vulnerabilities & Engineering Blockers

### Blocker 1: Overly Broad RLS Policies in Migration 022 (P0 Security)
- **Vulnerability:** Migration 022 introduced:
  ```sql
  CREATE POLICY users_app_read_scope ON users FOR SELECT TO operza_app USING (true);
  CREATE POLICY agencies_app_read_scope ON agencies FOR SELECT TO operza_app USING (true);
  CREATE POLICY locations_app_read_scope ON locations FOR SELECT TO operza_app USING (true);
  CREATE POLICY memberships_app_read_scope ON agency_memberships FOR SELECT TO operza_app USING (true);
  ```
- **Impact:** PostgreSQL evaluates multiple permissive policies for the same role using logical **OR**. Because `operza_app` has `USING (true)`, any tenant query executed by the application backend without an explicit `WHERE` clause or under rogue tenant context can read across all agencies, locations, and users.
- **Required Fix (Stage 1):** Create migration `023_tenant_rls_policy_repair.sql` to drop these unrestricted read policies and replace them with strict tenant-bound policies (`id = current_setting('app.agency_id')::uuid`, user context matching, or controlled security definer functions for unauthenticated signup).

### Blocker 2: Unrestricted Worker Data Access in Migration 020 (P0 Security)
- **Vulnerability:** Migration 020 created worker policies using `USING (true) WITH CHECK (true)` on:
  - `workflow_executions`
  - `workflow_execution_steps`
  - `workflow_approvals`
  - `workflow_definitions`
  - `location_records`
  - `opportunities`
- **Impact:** While `operza_worker` needs to process queue items across tenants, individual job executions must execute within a transaction bound to `set_config('app.agency_id', job.tenantId, true)`. Unrestricted policies allow worker handlers to access data outside the claimed job's tenant.
- **Required Fix (Stage 1):** Scoped worker policies in migration 023 requiring `agency_id = current_setting('app.agency_id')::uuid` during job processing.

### Blocker 3: In-Memory Only Approval Expiration (P0 Reliability)
- **Defect:** `expirePendingWorkflowApprovals()` in `apps/api/server.mjs` only updates `state.workflowApprovals` in memory. In PostgreSQL mode, expired approvals remain pending in the database indefinitely unless an operator visits the approvals page, and even then, database rows are not transitioned transactionally.
- **Impact:** Expired approvals can still be approved, executions stall in `waiting_approval` instead of transitioning to `failed` with `APPROVAL_EXPIRED`, and worker leases are not properly cleaned up.
- **Required Fix (Stage 2):** Implement PostgreSQL-authoritative expiration in `server.mjs` and worker scheduler.

### Blocker 4: GitHub Actions Hosted Runner Account Lock (P1 Infrastructure)
- **Defect:** GitHub Actions workflow run `43959812929` on commit `104317f` was rejected at queue time with:
  > *"The job was not started because your account is locked due to a billing issue."*
- **Impact:** Cloud CI cannot start runner virtual machines.
- **Mitigation & Rule (Stage 16):** All release verification must be proven locally using genuine Docker containers, PostgreSQL 16 cluster instances, and Node.js test runners. Remote status must be documented truthfully without claiming unverified CI passes.

### Blocker 5: Residual In-Memory Fallbacks in Production Mode (P1 Data Consistency)
- **Defect:** Certain routes in `server.mjs` check `if (!pgPool)` or catch database errors and fall back to `state.records` in memory or JSON snapshots.
- **Impact:** Risk of silent split-brain writes and false-positive HTTP 200 responses when database persistence fails.
- **Required Fix (Stage 5):** Eliminate silent memory fallbacks in staging/production modes. Fail loud with structured error codes (`DATABASE_WRITE_FAILED`, `PERSISTENCE_FAILED`).

---

## 4. System Dependency & Data Flow Map

```
[Web Client (React 19)]
        │
        │ HTTP / CSRF / Session Cookie / WebSocket
        ▼
[API Server (server.mjs)]
   ├── Authentication & Actor Resolution (auth_sessions, users, memberships)
   ├── Tenant & Location Scoping (app.agency_id, app.location_id)
   ├── Relational Reads/Writes (PostgreSQL 16 with FORCE RLS)
   └── Outbox Producer (produceWorkflowTriggerEvent, produceConnectorActionEvent)
        │
        │ INSERT INTO workflow_outbox (status: 'pending', idempotency_key)
        ▼
[PostgreSQL 16 Authority]
   ├── Core: agencies, locations, users, agency_memberships
   ├── CRM: contacts (location_records), opportunities, pipelines, calendars, appointments
   ├── Governance: communication_consents, provider_secrets, audit_events, billing_ledger
   └── Durable Engine: workflow_definitions, workflow_executions, workflow_approvals, workflow_outbox
        │
        │ Row-level Lock: SELECT ... FOR UPDATE SKIP LOCKED
        ▼
[Durable Worker (worker.mjs / durable-worker.mjs)]
   ├── Claim Job (lease_id, lease_expires_at, attempts)
   ├── Bind Tenant Context in Transaction (set_config)
   ├── Authoritative Consent Verification (status: 'granted', non-expired)
   ├── Action Governance & Definition Hash Verification
   ├── Provider Adapter Dispatch (Google, Microsoft, Twilio, SendGrid)
   ├── Transactional State Updates (workflow_executions, workflow_execution_steps)
   └── Acknowledge Outbox (status: 'delivered', action_receipt)
```

---

## 5. Starting Baseline Gate Results

Prior to starting Stage 1 corrections, local test execution on commit `104317f` established the following verified baseline:
- `apps/api/test/durable-workflow-and-postgres.test.mjs`: **20 / 20 PASS** (Local PG 16)
- `@operza/platform-core`: **108 / 108 PASS**
- `@operza/workflow-engine`: **66 / 66 PASS**
- `@operza/action-governance`: **6 / 6 PASS**
- `@operza/db`: **39 / 39 PASS** (1 skipped - remote staging test)
- `apps/api/test/release-verification-gaps.test.mjs`: **10 / 10 PASS**
- `apps/api/test/appointment-concurrency-api.test.mjs`: **9 / 9 PASS** (Multi-process API)
- `@operza/web`: **typecheck PASS**, **build PASS** (136 modules)

### Stage 0 Status
- **Stage 0 Objective:** Complete.
- **Proceeding to:** STAGE 1 — P0 MULTI-TENANT SECURITY AND DATABASE RLS.
