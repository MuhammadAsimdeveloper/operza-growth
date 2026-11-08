# OPERZA RUNTIME INTEGRATION CALL MAP
## Verified Architecture, Inter-Module Call Graphs & Execution Paths

**Audit Date:** 2026-11-08  
**Auditor:** Principal Software Architect & Technical Director  
**Environment:** Operza Canonical Repository (`operza-growth`)  
**Commit Baseline:** `feat/operza-unified-atlas-automation`  
**Execution Runtime:** Node.js v24.22.0 (ESM, Native `node:http`, WebSocket `ws`)

---

## 1. Executive Architecture Realignment

A central finding of this independent audit was correcting the previous inaccurate claim that `apps/api/server.mjs` was a Fastify plugin architecture. 

In actual reality, `apps/api` runs on **Native `node:http`** with high-throughput streaming and WebSocket synchronization. Rather than arbitrarily rewriting the API server to Fastify, the architecture has been modularized cleanly into dedicated route handlers:
- `apps/api/routes/system.mjs` (Health, readiness, metrics, worker debug)
- `apps/api/routes/auth.mjs` (JWT session tokens, CSRF protection, password hashing, RBAC)
- `apps/api/routes/agency.mjs` (Multi-tenant locations, snapshots, team management, white-label branding)
- `apps/api/routes/crm.mjs` (Bulk tagging, formula-defended CSV import/export, contact merge, timelines, smart lists)

Below is the verified end-to-end call path map connecting every major subsystem.

---

## 2. End-to-End Runtime Call Graphs

```mermaid
flowchart TD
    subgraph ClientLayer [Client & Webhook Ingress]
        Browser[React 19 Vite Web App]
        ZapierIngress[Zapier / Webhook Ingress]
        TwilioMeta[Twilio SMS / WhatsApp / Meta Webhooks]
        PublicPages[Public Calendars / Payments / Forms]
    end

    subgraph ApiServerMonolith [API Monolith: apps/api/server.mjs]
        HttpServer[Native node:http Server on Port 4005]
        CorsCsrf[CORS, CSRF Token & Rate Limiter]
        AuthSession[Session & Agency/Location Scoper]
        
        subgraph ModularRouters [Modular Route Dispatchers]
            SystemRouter[routes/system.mjs]
            AuthRouter[routes/auth.mjs]
            AgencyRouter[routes/agency.mjs]
            CrmRouter[routes/crm.mjs]
        end
    end

    subgraph SecurityGovLayer [Platform Security & Governance]
        ActionGov[packages/action-governance: ReDoS Schemas & Input Sanitizer]
        SSRFDefense[packages/platform-core: assertSafeTargetUrl & DNS Pinning]
        BillingLedger[packages/platform-core: Credit Balance Ledger & Audit Chain]
        SecretVault[packages/platform-core: AES-256-GCM Secret Vault]
    end

    subgraph AutomationLayer [Workflow & Worker Runtime]
        WorkflowEngine[packages/workflow-engine/src/engine.mjs]
        DurableLeases[packages/workflow-engine/src/durable-leases.mjs]
        OutboxWorker[packages/platform-core/src/outbox-worker.mjs]
        WorkerProcess[apps/api/worker.mjs]
    end

    subgraph CopilotLayer [Copilot 2.0 & Multi-Agent Swarm]
        CopilotSwarm[MultiAgentOrchestrator: 10 Specialized Agents]
        ToolPerms[tool-permissions: Read Execute / Write Propose]
        ProposalExecutor[proposal-executor: Governed Proposal Execution]
    end

    subgraph PersistenceLayer [Storage & Persistence]
        StoreJson[Zero-Config Mode: apps/api/data/store.json]
        PgCluster[Production Mode: PostgreSQL 16 RLS Migrations 001-014]
    end

    Browser --> HttpServer
    ZapierIngress --> HttpServer
    TwilioMeta --> HttpServer
    PublicPages --> HttpServer

    HttpServer --> CorsCsrf --> AuthSession
    AuthSession --> SystemRouter
    AuthSession --> AuthRouter
    AuthSession --> AgencyRouter
    AuthSession --> CrmRouter

    CrmRouter --> ActionGov
    CrmRouter --> StoreJson

    HttpServer --> CopilotSwarm
    CopilotSwarm --> ToolPerms
    ToolPerms --> ProposalExecutor
    ProposalExecutor --> BillingLedger
    ProposalExecutor --> StoreJson

    HttpServer --> WorkflowEngine
    WorkerProcess --> OutboxWorker
    OutboxWorker --> DurableLeases
    WorkflowEngine --> DurableLeases
    WorkflowEngine --> SSRFDefense
    WorkflowEngine --> ActionGov
    WorkflowEngine --> SecretVault
```

---

## 3. Detailed Subsystem Call Paths

### 3.1 Outbound Workflow Execution & SSRF Defense Call Path
When a workflow node triggers an external side-effect (Webhook, HTTP Request, Slack, or Zapier):
1. **Trigger Ingress:** Workflow instance triggered via on-demand API (`POST /api/workflows/:id/run`), event outbox, or schedule tick.
2. **Execution Lease Claim:** `claimExecutionLease()` in `durable-leases.mjs` binds the execution to the worker process lease with a 60-second TTL.
3. **Template Hydration:** `renderTemplate()` interpolates contextual variables (`{{contact.email}}`, etc.).
4. **Governance Inspection:** If direct network execution is attempted without explicit connector scope, `isDirectNetworkNode()` blocks it (`DIRECT_NETWORK_TARGET_DISABLED`).
5. **SSRF Validation:** When allowed, target URLs pass through `assertSafeTargetUrl()`:
   - Validates HTTPS scheme (strictly forbids `http:`, `file:`, `gopher:`).
   - Forbids userinfo credentials (`https://user:pass@host/`).
   - Forbids private hostnames (`localhost`, `.internal`, `.local`, metadata domains).
   - Blocks RFC 1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
   - Blocks cloud metadata IP (`169.254.169.254`) and loopbacks (`127.0.0.1`, `::1`).
6. **Execution Lease Heartbeat:** Worker ticks `heartbeatExecutionLease()` on each completed node step.
7. **Lease Release:** On terminal completion or failure, `releaseExecutionLease()` frees the execution state and records `finishedAt` and `lastErrorCode`.

### 3.2 Copilot Multi-Agent Proposal & Credit Ledger Gating Call Path
When an operator interacts with the AI Copilot to mutate CRM records or generate automations:
1. **User Prompt Ingress:** Client calls SSE streaming endpoint `POST /api/copilot/chat` or WebSocket.
2. **Swarm Routing:** `MultiAgentOrchestrator` routes prompt to specialized domain agents (CRM, Automation, Sales, Marketing, Analytics, etc.).
3. **Permission Enforcement:** `tool-permissions.mjs` intercepts mutating tool requests (`create_contact`, `generate_workflow`, etc.) and forces status to `pending_review`. CRM is **never mutated synchronously** by AI.
4. **Human-in-the-Loop Approval:** An admin reviews the proposal and calls `POST /api/copilot/proposals/:id/approve` (records approval decision without mutation).
5. **Authoritative Execution with Credit Gating:** An admin calls `POST /api/copilot/proposals/:id/execute`:
   - `executeCopilotProposal()` calls `gateAiToolExecution()`.
   - Checks location's balance in `createBillingLedgerStore()`. If 0 or insufficient, **fails closed** with `INSUFFICIENT_CREDITS`.
   - Debits the tool execution cost from the location's credit balance.
   - Appends a cryptographically hash-chained transaction entry to the ledger.
   - Invokes the registered mutation handler.
   - Generates an immutable, sanitized `ActionReceipt` containing execution diffs and removes raw credential tokens.
   - Persists state and broadcasts event over WebSockets.

### 3.3 CRM Enhanced Operations & Smart List Filtering Call Path
When performing contact operations or saved view evaluations:
1. **Modular Routing:** Request matches `/api/crm/*` and is delegated to `handleCrmRoutes()` in `apps/api/routes/crm.mjs`.
2. **Bulk Tagging:** Contacts are isolated by `agency.id` and `activeLocation.id`; tags are deduplicated and updated with audit logs.
3. **CSV Import / Export:**
   - **Import:** `parseAndValidateCsvImport()` scans CSV text, strips spreadsheet formula injection characters (`=`, `+`, `-`, `@`, `\t`, `\r`), preserves international phone numbers, checks existing contacts for duplicates, and creates leads.
   - **Export:** `exportContactsToCsv()` filters tenant contacts and escapes dangerous formula characters in generated CSV output.
4. **Smart Lists:**
   - Saved views are created with `createSmartListView()` supporting composite conditions (`equals`, `contains`, `greater_than`, `less_than`, `starts_with`, `in`) and nested AND/OR logic.
   - Evaluated via `filterSmartListRecords()` or converted into secure parameterized SQL via `generateSmartListSql()` with enforced composite agency/location filters.

---

## 4. Verification Proof Summary

| Subsystem Call Path | Verified Entrypoint | Key Interceptor / Guardrail | Observable Output |
| :--- | :--- | :--- | :--- |
| **Workflow Engine** | `POST /api/workflows/:id/run` | `assertSafeTargetUrl()` + `claimExecutionLease()` | SSRF blocked, leases renewed & released |
| **Action Governance** | `createActionInvocation()` | `normalizeActionSchemas()` + `validateActionInput()` | ReDoS patterns & credentials rejected |
| **AI Tool Gating** | `POST /api/copilot/proposals/:id/execute` | `gateAiToolExecution()` on `billingLedgerStore` | Balance debited, zero credits fail closed |
| **CRM Routes** | `POST /api/crm/contacts/import` | `handleCrmRoutes()` + `parseAndValidateCsvImport()` | Formula injections stripped, contacts imported |
| **Smart Lists** | `POST /api/crm/smart-lists/:id/query` | `filterSmartListRecords()` + tenant RLS scope | AST filtered contacts returned with count |
