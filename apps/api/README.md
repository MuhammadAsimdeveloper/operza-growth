# @operza/api

Production-grade Express ESM REST API, real-time WebSocket hub, autonomous Copilot SSE streaming service, and BullMQ-compatible distributed queue for the Operza business automation platform.

---

## 🏛️ Architecture Overview

The Operza API layer is built with high-throughput Node.js (ESM native), featuring:

- **Dual-Mode Persistence Layer:**
  - **PostgreSQL with Row-Level Security (RLS):** Application queries run under unprivileged role `operza_app` with session variables (`SET LOCAL app.current_agency_id = '...'`).
  - **Zero-Config JSON Store Fallback:** For instantaneous local development, testing, and edge nodes without Docker/PostgreSQL, state persists atomically to `data/store.json`.
- **Distributed Queue System (`queue.mjs`):**
  - High-performance native RESP protocol over TCP socket with zero external client dependencies.
  - Redis BullMQ compatibility with FIFO job queuing, exponential retry backoff, and state inspection.
  - High-precision in-memory fallback queue with async promise resolution when `REDIS_URL` is omitted.
- **Real-Time Communication:**
  - WebSocket hub (`/ws`) for instant pipeline, appointment, and workflow execution state broadcasts.
  - Server-Sent Events (`/api/copilot/stream`) for low-latency AI Copilot token streaming.
- **Public Ingress & Webhooks:**
  - Public Calendar booking (`/api/calendars/book/:slug`)
  - Public Payment & Checkout (`/api/payments/checkout/:slug`)
  - Public Form submission (`/api/forms/submit/:slug`)
  - Public Review submission (`/api/reviews/submit/:slug`)
  - Inbound Twilio SMS & Voice webhook ingestion (`/api/webhooks/twilio`)
  - Public Webchat widget script & message ingress (`/widget/operza.js`, `/api/widget/message`)

---

## 🔌 API Endpoints Summary

| Group | Method | Endpoint | Description |
|-------|--------|----------|-------------|
| **System** | `GET` | `/health` | Liveness health check |
| | `GET` | `/ready` | Container readiness probe (DB status) |
| | `GET` | `/metrics` | Process RSS memory & WS active client telemetry |
| **Admin** | `GET` | `/api/admin/queue/status` | Queue engine status (Redis or In-Memory) |
| | `POST` | `/api/admin/queue/test-job` | Enqueue a test diagnostic job |
| | `GET` | `/api/admin/db/status` | Database engine status (PostgreSQL or JSON) |
| **Auth** | `POST` | `/api/auth/signup` | Register new agency owner & capture CSRF |
| | `POST` | `/api/auth/login` | Authenticate session |
| | `GET` | `/api/auth/session` | Inspect active authenticated session |
| **CRM** | `GET/POST` | `/api/crm/contacts` | Query & create contacts with tags and smart lists |
| | `GET/POST` | `/api/crm/pipelines` | Opportunity pipelines & stage stages |
| | `GET/POST` | `/api/crm/tasks` | Workspace task management |
| | `GET/POST` | `/api/crm/calendars` | Appointment schedules & booking slots |
| | `GET/POST` | `/api/crm/invoices` | Billing, line items & payment tracking |
| | `GET/POST` | `/api/crm/documents` | Digital contracts & legal e-signatures |
| | `GET/POST` | `/api/crm/phoneNumbers` | Virtual phone number provisioning & IVR routing |
| **Workflows** | `GET/POST` | `/api/crm/workflows` | Automation workflow blueprints |
| | `POST` | `/api/workflows/:id/run` | Side-effect-free workflow dry run with condition evaluation |
| | `GET` | `/api/workflows/runs` | Redacted workflow execution history for the active workspace |
| | `GET` | `/api/workflows/approvals` | List pending action-specific approvals |
| | `POST` | `/api/workflows/runs/:id/approve` | Approve the pending action and resume from the pinned node |
| | `POST` | `/api/workflows/runs/:id/reject` | Reject the pending action without executing it |
| **Copilot** | `GET` | `/api/copilot/stream` | Real-time SSE AI token streaming |
| | `POST` | `/api/copilot/chat` | AI Copilot conversational query |
| | `POST` | `/api/copilot/knowledge` | Ingest grounding documents into knowledge base |
| **Agency** | `GET/POST` | `/api/agency/locations` | Multi-tenant sub-account provisioning |
| | `GET/POST` | `/api/agency/snapshots` | Reusable agency blueprints & 1-click deployments |
| | `GET/PUT` | `/api/agency/branding` | Custom white-label domain & portal branding |

---

## Approval persistence and execution recovery

- Approval requests and decisions are persisted in `state.workflowApprovals` alongside `workflowExecutions`.
- The existing `saveState()` pipeline writes the state envelope through atomic JSON replacement and, when configured, the PostgreSQL `operza_app_state` snapshot.
- Each run stores a private workflow snapshot and version reference. Approval is bound to a single node and deterministic action hash; approval never means “mark the run completed”.
- The decision is persisted before the resume call. A process restart recovers executions left in the `resuming` state.
- API responses use an allow-listed projection; private snapshots, raw trigger payloads, approval evidence and action hashes stay server-side.

**Current boundary:** This is durable single-application-state persistence, not a normalized approval table or a multi-worker transactional outbox. Multi-instance leases, transactional action receipts, provider-level idempotency enforcement, and real external provider adapters remain future work. No live message is sent by this approval feature.

## 🚀 Running the API

```bash
# Start with auto-reload (Node --watch)
npm run dev

# Or directly
node server.mjs
```
