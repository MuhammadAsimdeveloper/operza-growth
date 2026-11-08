# Deliverable 1: Operza Canonical Repository Architecture Audit

**Canonical Repository:** `MuhammadAsimdeveloper/operza-growth`  
**Inspected Path:** [`C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza)  
**Branch:** `feat/operza-unified-atlas-automation` | **Commit:** `f2595a1`  
**Lead Auditor:** Principal Software Architect & Technical Director  
**Applied Methodology:** Superpowers (`using-superpowers`, `brainstorming`), Matt Pocock (`codebase-design`, `improve-codebase-architecture`), Addy Osmani (`api-and-interface-design`)

---

## 1. Monorepo Structure & Package Topology

Operza is organized as an npm workspace monorepo configured in [`package.json`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/package.json):
```json
{
  "name": "operza",
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

### Monorepo Workspaces Inventory
1. **`apps/web`** ([`package.json`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/package.json)): React 19, Vite 5.4, Tailwind CSS, Lucide React, client-side React Router. Represents the full user-facing portal.
2. **`apps/api`** ([`package.json`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/api/package.json)): Node.js server. **Key Finding:** Does not use Fastify or Express; built using native `node:http` `createServer`.
3. **`packages/db`** ([`package.json`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/db/package.json)): PostgreSQL client, connection pooler (`pg`), migrations (`001` through `010`), and Row-Level Security policies.
4. **`packages/platform-core`** ([`package.json`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/platform-core/package.json)): Domain services, consent policies, outbox producer/worker, provider adapters, secret vault, entitlements, and the Copilot multi-agent runtime.
5. **`packages/workflow-engine`** ([`package.json`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/workflow-engine/package.json)): Visual builder graph compiler, node registry, step executor, and approval lifecycle state machine.
6. **`packages/shared`** ([`package.json`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/shared/package.json)): Common TypeScript types, constants, and utilities.

---

## 2. Deep Dive: Backend Architecture (`apps/api`)

### Architectural Anomaly: The 8,670-Line Monolith
Inspection of [`apps/api/server.mjs`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/api/server.mjs) reveals an **8,670-line single-file monolith** (427,822 bytes).

```text
apps/api/server.mjs
├── Lines 1–46: Imports from platform-core, workflow-engine, db, crypto, node:http
├── Lines 47–890: In-memory store sync, JSON file persistence (data/store.json), CSRF tokens, session maps
├── Lines 891–1963: Helper routines for body buffering, auth header extraction, URL parsing, rate limiting
└── Lines 1964–8670: A single createServer() callback with an enormous cascading if-else router:
    ├── /health, /ready, /metrics
    ├── /api/auth/* (login, signup, session, csrf)
    ├── /api/crm/* (contacts, opportunities, pipelines, custom-fields)
    ├── /api/workflows/* (CRUD, execution runner, pause/resume, runs)
    ├── /api/calendars/* & /api/appointments/*
    ├── /api/copilot/* (SSE chat stream, proposals, agent delegation)
    ├── /api/webhooks/* (Twilio SMS/voice, Stripe, Zapier)
    ├── /api/agency/* (sub-accounts, snapshots, locations)
    └── /api/admin/* (queue status, outbox ticks, telemetry)
```

### Strengths of `apps/api`
1. **Zero-Config Developer Experience:** Automatically falls back to `data/store.json` when PostgreSQL is unavailable, allowing instant local testing without spinning up infrastructure.
2. **Comprehensive Capability Surface:** Implements functional endpoints for CRM, marketing, calendar booking, payments, agency snapshots, WebRTC softphone tokens, and Copilot streaming.
3. **Hermetically Tested:** Backed by 116 passing end-to-end integration tests in `scripts/test-e2e.mjs`.

### Critical Weaknesses & Architectural Risks
1. **Extreme Monolithic Fragility:** Any syntax error or unhandled exception in `server.mjs` risks taking down the entire API.
2. **Missing Framework Abstractions:** Manual parsing of URLs, query strings, multipart forms, and JSON payloads leads to repeated boilerplate and inconsistent status codes.
3. **Dual Persistence Mode Discrepancy:** The code bifurcates between writing to `data/store.json` and delegating to `packages/db`. When running against real PostgreSQL, some endpoints bypass RLS by issuing direct SQL queries rather than going through repository abstractions.
4. **Lack of Route-Level Isolation:** Routes cannot be unit-tested in isolation without booting the complete HTTP server.

---

## 3. Database Architecture (`packages/db`)

### Schema & Migration History
The database schema is defined in 10 forward-only migrations:
- [`001_agency_tenant_core.sql`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/db/migrations/001_agency_tenant_core.sql): Establishes `agencies`, `users`, `agency_memberships`, and `locations`.
- [`002_public_form_registry.sql`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/db/migrations/002_public_form_registry.sql): Maps public form slugs to `(agency_id, location_id)`.
- [`003_workflow_executions.sql`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/db/migrations/003_workflow_executions.sql): `workflow_definitions`, `workflow_executions`, `workflow_execution_steps`.
- [`004_workflow_templates.sql`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/db/migrations/004_workflow_templates.sql): System and agency templates.
- [`005_agency_snapshots.sql`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/db/migrations/005_agency_snapshots.sql): Sub-account cloning blueprints.
- [`006_ecosystem_and_telephony.sql`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/db/migrations/006_ecosystem_and_telephony.sql): `telephony_calls`, `developer_api_keys`.
- [`007_workflow_step_simulation_status.sql`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/db/migrations/007_workflow_step_simulation_status.sql): Adds `simulated` step state.
- [`008_platform_foundation.sql`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/db/migrations/008_platform_foundation.sql): `provider_connections`, `consents`, `workflow_outbox`, `action_receipts`, `usage_events`, `plan_entitlements`.
- [`009_copilot_proposals.sql`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/db/migrations/009_copilot_proposals.sql): `copilot_proposals` with forced RLS.
- [`010_zapier_and_agent_suite.sql`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/db/migrations/010_zapier_and_agent_suite.sql): `zapier_hook_subscriptions`, `zapier_hook_deliveries`.

### RLS & Tenant Safety Findings
- **Strengths:** Forced RLS is enabled on core tables (`copilot_proposals`, `workflow_executions`, `provider_connections`). The test suite (`platform-repository.test.mjs`) explicitly tests that superuser bypass roles and missing tenant contexts are rejected.
- **Vulnerabilities:** In `001_agency_tenant_core.sql`, tables created initially (`agencies`, `users`, `agency_memberships`) lack forced RLS directives. User queries rely on application-level filtering rather than database-enforced RLS.

---

## 4. Automation & Workflow Engine (`packages/workflow-engine`)

- **Graph Model:** Directed Acyclic Graph (DAG) stored as JSONB with nodes and connections.
- **Node Execution:** Implements step evaluation in [`src/engine.mjs`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/workflow-engine/src/engine.mjs).
- **Governance:** [`src/action-governance.mjs`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/workflow-engine/src/action-governance.mjs) distinguishes simulated actions from live actions and blocks raw HTTP URLs.
- **Approval Gates:** [`src/approval-lifecycle.mjs`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/packages/workflow-engine/src/approval-lifecycle.mjs) implements cryptographic token generation and approval expiration.

---

## 5. Frontend Architecture (`apps/web`)

- **Framework:** React 19 with Vite 5.4.
- **UI Architecture:** 40+ pages in `src/pages/`, modular navigation shell in `AppShell.tsx`, rich dashboard widgets.
- **State Management:** Mix of local component state and API fetch wrappers.
- **Vercel Best Practice Compliance:**
  - Waterfalls detected: Several pages fetch dashboard stats, user session, and list data sequentially inside multiple `useEffect` hooks rather than in parallel.
  - Boolean prop proliferation: Complex components like `Funnels.tsx` (25KB) and `Websites.tsx` (92KB) contain dozens of conditional flags rather than compound component composition.

---

## 6. Synthesis & Audit Verdict

Operza is a remarkably comprehensive product with a rich, responsive frontend and an extensive capability footprint. However, its backend architecture suffers from severe monolithic concentration in `apps/api/server.mjs`. The primary refactoring priority must be modularizing `apps/api` into clean, domain-scoped route controllers using a standardized framework (e.g., Fastify) while preserving its exact API contracts.
