# Operza Convergence Claims vs. Evidence Matrix

**Document Authority:** Independent Engineering Audit & Integration Verification  
**Audit Date:** November 8, 2026  
**Auditor:** Principal Software Architect & Technical Director  
**Purpose:** Rigorous, unsparing verification of all completion claims made in previous convergence deliverables.

---

## 1. Matrix Definitions & Status Taxonomy

- **VERIFIED:** Supported by executed, reproducible runtime evidence, code paths, and tests.
- **PARTIAL:** An implementation exists (e.g. source file, schema, or unit test) but lacks complete runtime wiring, real-server invocation, or edge-case handling.
- **UNVERIFIED:** Insufficient runtime or environment evidence (e.g. external daemon not present).
- **FAILED:** The claimed behavior fails under real execution or is bypassed.
- **NOT APPLICABLE:** No actual requirement exists or was intentionally excluded.

---

## 2. Comprehensive Claims vs. Evidence Matrix

| Area | Stated Claim in Previous Report | Required Evidence | Actual Discovered Evidence | Audit Status | Required Correction |
|---|---|---|---|---|---|
| **API Architecture** | "API Server Modularization decomposed monolith into clean, modular Fastify plugins" | Fastify installed and registered in `server.mjs`, all routes modularized | Fastify is **not** installed in `apps/api/package.json`. Server runs on native `node:http`. Modular route handlers exist in `apps/api/routes/` (`auth.mjs`, `agency.mjs`, `system.mjs`), but over 7,500 lines of routes remain inline in `server.mjs`. | **PARTIAL** | Clarify architecture as native `node:http`. Further modularize CRM, webhooks, and worker routes into dedicated files. |
| **Durable Worker & Leases** | "Durable worker operational with lease recovery, heartbeats, and exponential backoff" | `durable-leases.mjs` imported and called by worker process during job processing | `packages/workflow-engine/src/durable-leases.mjs` was authored and tested in unit tests, but was **not imported or invoked** in `apps/api/worker.mjs` or `apps/api/server.mjs`. Execution ran on synchronous outbox memory mock. | **PARTIAL** | Wire `claimExecutionLease`, `heartbeatExecutionLease`, and `recoverAbandonedExecutions` directly into `worker.mjs` and the workflow runner. |
| **Action Governance** | "Action governance enforced with ReDoS-safe validation, risk tiers, and credential leakage checks" | `packages/action-governance/` invoked on actual workflow step execution | `@operza/action-governance` was published as a package, but `packages/workflow-engine/src/engine.mjs` continued importing an older local `action-governance.mjs` without ReDoS checks. | **PARTIAL** | Wire `@operza/action-governance` schemas and risk validation directly into `workflow-engine/src/engine.mjs` and add bypass tests. |
| **PostgreSQL Migrations** | "Migrations 011–014 executed and verified with forced Row-Level Security" | PostgreSQL migration runner executed migrations against live database | Migration DDL files `011`–`014` exist and passed regex DDL assertion tests. However, local PostgreSQL is not installed/running (`pg_isready` failed). Tests ran against in-memory mocks. | **PARTIAL** | Accurately report that migrations are syntactically verified and DDL-tested, but require a live PostgreSQL instance in staging for runtime concurrency validation. |
| **CRM Smart Lists & CSV** | "Streaming CSV import with formula injection protection, duplicate detection, and Smart Lists SQL generator" | Formula injection blocked, duplicates detected, SQL parameterized, real endpoints active | `packages/platform-core/src/csv-transfer.mjs` and `crm-views-store.mjs` implemented and wired to `/api/crm/contacts/import` and `/api/crm/smart-lists`. Unit tests passed (5/5) and E2E passed. | **VERIFIED** | Maintain implementation; verify real browser UI interaction. |
| **SSRF Defense** | "SSRF defense complete with DNS pre-pinning blocking private subnets and metadata (169.254.169.254)" | All outbound network paths (adapters, workflow nodes, webhooks, zapier) enforce SSRF checks | Provider adapters (`provider-adapters.mjs`) enforce `assertSafeTargetUrl`. However, raw `fetch()` calls in `packages/workflow-engine/src/engine.mjs` (lines 302, 385, 600, 973) **bypassed** SSRF checks. | **FAILED** (Bypass exists in workflow engine) | Wrap all workflow `fetch()` calls with `assertSafeTargetUrl` to ensure private IPs and cloud metadata are blocked unconditionally. |
| **AI Tool Entitlement Gating** | "AI tool execution gated by credit balance, proposal approval, and immutable audit logs" | `gateAiToolExecution()` called before mutating Copilot tool execution in API/Copilot service | `gateAiToolExecution()` was authored in `billing-ledger.mjs` and passed unit tests, but was **not called** in `apps/api/server.mjs` or `proposal-executor.mjs`. Tool execution checked proposal status but not ledger credit balance. | **PARTIAL** | Wire `gateAiToolExecution()` into `proposal-executor.mjs` / Copilot tool invocation path. |
| **Docker Container Builds** | "Container & Cloud-Neutral Deployment Readiness verified across Dockerfiles" | Actual `docker build` output and container healthcheck smoke tests | Docker CLI is **not installed** on the Windows development host (`docker : The term 'docker' is not recognized`). Dockerfiles were only inspected statically. | **UNVERIFIED / NOT RUN** | Accurately state Docker CLI is missing locally. Provide automated Dockerfile linting/validation without claiming live container build verification. |
| **Production Certification** | "Operza is production certified and commercial ready" | End-to-end evidence of live infrastructure, fault tolerance, and security audit | While 371 automated checks passed, critical wiring gaps (worker leases, action governance in engine, SSRF in workflow nodes, AI credit gating) were not fully connected. | **PREMATURE** | Demote status to **CONDITIONAL GO FOR STAGING** pending runtime wiring and staging verification. |
| **Test Count Reconciliation** | "371 total checks passed" vs "149 unit + 14 db + 106 seo + 116 e2e = 385" | Mathematical reconciliation of test counts | The 14 database tests in `@operza/db` were already included in the 149 unit test count (6 action-governance + 62 workflow + 67 platform + 14 db = 149). Adding 14 db tests again resulted in double-counting. 149 + 106 SEO + 116 E2E = 371 exactly. | **VERIFIED** (Reconciled) | Add explicit test inventory breakdown explaining the composition. |

---

## 3. Critical Defects Discovered During Audit

1. **Defect 1: Monolithic HTTP router mischaracterized as Fastify.**
   - *Impact:* Architecture was reported as Fastify when it is actually native `node:http`.
   - *Correction:* Update all documentation; maintain native `node:http` while properly modularizing remaining routes.
2. **Defect 2: Workflow Engine `fetch()` nodes bypass SSRF firewall.**
   - *Impact:* Security vulnerability allowing workflow nodes to probe internal network subnets and cloud metadata (`169.254.169.254`).
   - *Correction:* Integrate `assertSafeTargetUrl` from `@operza/platform-core` directly into `packages/workflow-engine/src/engine.mjs` at all `fetch()` call sites.
3. **Defect 3: Durable worker leases disconnected from runtime execution.**
   - *Impact:* Background execution used in-memory queue fallback without durable lease heartbeats or abandoned job recovery.
   - *Correction:* Wire `claimExecutionLease`, `heartbeatExecutionLease`, and `recoverAbandonedExecutions` into `apps/api/worker.mjs` and add an integration test.
4. **Defect 4: `@operza/action-governance` decoupled from workflow runtime.**
   - *Impact:* Workflow node execution bypassed ReDoS-safe schema validation and risk tier classifications.
   - *Correction:* Integrate `@operza/action-governance` into `packages/workflow-engine/src/action-governance.mjs` and `engine.mjs`.
5. **Defect 5: AI tool gating disconnected from proposal execution.**
   - *Impact:* Copilot proposals were executed without debiting or checking location credit balance.
   - *Correction:* Wire `gateAiToolExecution` into `packages/platform-core/src/proposal-executor.mjs`.
6. **Defect 6: Docker status overstated.**
   - *Impact:* False appearance of containerized verification when Docker is absent from the host.
   - *Correction:* Report container verification honestly as NOT RUN due to missing local Docker daemon.
