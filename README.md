# Operza — Unified Business OS & Intelligent Automation Platform

**Operza** is a unified, production-grade business automation and agency CRM platform that merges the capabilities of:
* **GoHighLevel (GHL)**: Multi-tenant Agency CRM, Pipelines Kanban, Smart Lists, Omnichannel Inbox, Invoices, Public Forms & Calendars.
* **n8n & Workflow Orchestration**: Visual node graph automation, triggers, data transformations, conditional branching, and webhook handlers.
* **Autonomous AI Agents & Copilot**: Durable worker execution (`agent.turn.execute`), Server-Sent Events (SSE) token delta streaming, human approval gates, and CRM tool calling.

---

## 🏛️ Architecture & Project Structure

```
operza/
├── apps/
│   ├── web/                    # React 19 + TypeScript + Vite CRM Workspace UI (18+ modules)
│   └── api/                    # Node.js ESM REST API + Copilot SSE streaming + Ingress
│
├── packages/
│   ├── db/                     # PostgreSQL Migrations with forced Row-Level Security (RLS)
│   ├── workflow-engine/        # Durable workflow state machine, execution steps & retry logic
│   └── shared/                 # Shared domain types, contracts & schemas
│
├── docker-compose.yml          # PostgreSQL 16 (RLS) + Redis 7 + API + Web + n8n Studio
└── scripts/
    └── dev.mjs                 # Single command local runner
```

---

## 🚀 Quickstart (Local Development)

### Prerequisites
* Node.js >= 20.0.0
* (Optional) Docker for PostgreSQL & Redis. If Docker/PostgreSQL is not running, Operza automatically uses the local JSON fallback store (`data/store.json`) for zero-friction development.

### 1. Launch Services
```powershell
# From the repository root
node scripts/dev.mjs
```
This boots:
* **Operza Workspace UI:** [http://localhost:5173](http://localhost:5173)
* **Operza API Server:** [http://localhost:4000](http://localhost:4000)
* **API Health Check:** [http://localhost:4000/health](http://localhost:4000/health)

---

## 🔐 Multi-Tenancy & Security
* **Forced PostgreSQL Row-Level Security (RLS):**
  * Hierarchical tenancy: `agencies` → `locations` (workspaces) → `users`.
  * Enforces PostgreSQL session variables: `app.agency_id`, `app.location_id`, `app.user_id`.
  * Unprivileged application queries run under `operza_app`, preventing cross-tenant leakage at the database engine level.
* **Public Form Ingress:**
  * Forms generate opaque random slugs (`/f/:slug`). External submissions are validated and ingested directly into tenant records without exposing internal IDs.
  * Form submissions automatically create/update contacts and trigger matching background workflows.

---

## 🤖 Operza Copilot Chat Hub
* Floating Copilot AI widget available on every CRM page.
* Low-latency real-time token streaming over Server-Sent Events (`GET /api/copilot/stream`).
* **Human-in-the-Loop Safety:** Irreversible workflow steps (e.g. bulk email, payment refunds) pause in a `waiting_approval` state, displaying a notification in the Copilot Hub for one-click operator approval.
