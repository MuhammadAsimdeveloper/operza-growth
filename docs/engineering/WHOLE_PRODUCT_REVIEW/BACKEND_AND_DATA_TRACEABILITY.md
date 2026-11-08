# OPERZA WHOLE-PRODUCT AUDIT: BACKEND AND DATA TRACEABILITY

**Audit Date:** November 8, 2026
**Auditor Roles:** Principal Software Architect, Database Reliability Engineer, Senior Backend Engineer
**Repository:** `MuhammadAsimdeveloper/operza-growth`
**Branch:** `feat/operza-unified-atlas-automation` (`389aae8`)
**Backend Core:** `apps/api/server.mjs`, `apps/api/routes/*`, `packages/db/*`, `packages/platform-core/*`

---

## 1. Dual-Mode Persistence Architecture

Operza implements a **Dual-Mode Persistence Architecture** designed to support both frictionless zero-config local development and hardened, multi-tenant enterprise cloud deployments:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Operza API Server                               │
│                         (apps/api/server.mjs)                          │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
      [Production / Staging Mode]        [Local Dev / CI Test Mode]
                    │                                │
                    ▼                                ▼
       PostgreSQL 16+ Connection Pool        Atomic JSON Storage
       (pgPool via DATABASE_URL)             (data/store.json)
                    │                                │
    ┌───────────────┴──────────────┐         ┌───────┴───────────────────┐
    │  - Migrations 001 - 014      │         │  - Atomic write temp swap │
    │  - Row-Level Security (RLS)  │         │  - In-memory state cache  │
    │  - Composite tenant keys     │         │  - Fast zero-config boot  │
    │  - Outbox table triggers     │         │  - Deterministic CI tests │
    │  - Immutable audit logs      │         │  - Isolated test fixtures │
    └──────────────────────────────┘         └───────────────────────────┘
```

1. **Production & Staging Mode (`process.env.DATABASE_URL` present):**
   - Direct connection pool via `pg` (`packages/db/lib/database.mjs`).
   - Every tenant query sets local session parameters: `SET LOCAL app.current_agency_id = ...` and `SET LOCAL app.current_location_id = ...`.
   - All 14 SQL migrations applied (`001_agency_tenant_core.sql` through `014_immutable_audit_events.sql`).
   - Forced RLS (`ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`) on all business tables prevents cross-tenant data leakage even for superusers.
   - Outbox worker polls `operza_outbox` table using `SELECT FOR UPDATE SKIP LOCKED` for reliable, transactional job processing.
2. **Local Zero-Config Mode (`DATABASE_URL` absent):**
   - State managed in memory and synced atomically to `apps/api/data/store.json` using temporary file write + atomic rename (`rename(tempFile, dataFilePath)`).
   - Guarantees crash consistency during local offline development without requiring a local PostgreSQL daemon.

---

## 2. End-to-End Request Call Path Traceability

Every major user interaction traces through a documented 8-step execution path:

```text
Frontend Screen (React 19)
      ↓ (User Interaction)
API Client (`apps/web/src/lib/api.ts`)
      ↓ (HTTP Request + Cookies + `x-operza-csrf` + `x-operza-location`)
Security & Middleware Layer (`apps/api/server.mjs`)
      ↓ (Rate Limiter, CORS, CSRF verification, Request Correlation ID)
Authentication & Tenant Resolution (`apps/api/routes/auth.mjs` / `getActor`)
      ↓ (Session validation, RBAC checks, agencyId & locationId binding)
Domain Operation & Validation (`packages/platform-core` & `workflow-engine`)
      ↓ (Input sanitization, CSV formula escaping, action governance)
Persistence Layer (`packages/db` Repository or atomic store)
      ↓ (RLS parameterized SQL execution or atomic state sync)
Response Serialization & Audit Recording
      ↓ (JSON payload returned + WebSocket broadcast + immutable audit event)
Frontend Reactive State Update (Zustand/Context store & DOM render)
```

---

## 3. Comprehensive Traceability Matrix Across Modules

| Product Capability | Frontend Source | API Endpoint | Auth & Tenant Enforcement | Domain Logic Module | Database / Storage Target | Status |
|---|---|---|---|---|---|---|
| **User Signup & Workspace Setup** | `pages/Signup.tsx` | `POST /api/auth/signup` | Public (Unauthenticated); validates email format & password scrypt hash | `apps/api/routes/auth.mjs` | `agencies`, `users`, `locations`, `agency_memberships` | **VERIFIED** |
| **Session Authentication** | `pages/Login.tsx` | `POST /api/auth/login` | Rate limited (10/min); verifies scrypt hash | `apps/api/routes/auth.mjs` | Issues secure HTTP-only cookies (`operza_session`, `operza_csrf`) | **VERIFIED** |
| **Contact Creation** | `pages/Contacts.tsx` | `POST /api/crm/contacts` | `sessionRequired`; extracts `agencyId` & `locationId` from token | `apps/api/routes/crm.mjs` | `contacts` table (RLS enforced) + WebSocket broadcast `crm.contact.created` | **VERIFIED** |
| **Contact 360 Timeline** | `pages/ContactDetail.tsx` | `GET /api/crm/contacts/:id/timeline` | `sessionRequired`; verifies contact belongs to active agency | `apps/api/server.mjs:L2450` | Aggregates activities, messages, calls, appointments, and invoices | **VERIFIED** |
| **CSV Bulk Contact Ingestion** | `pages/Contacts.tsx` | `POST /api/crm/contacts/import` | `sessionRequired`; sanitizes formula injection (`=`, `+`, `-`, `@`) | `packages/platform-core/src/csv-transfer.mjs` | Batch inserts into `contacts` + audit trail record | **VERIFIED** |
| **Contact Deduplication & Merge** | `pages/Contacts.tsx` | `POST /api/crm/contacts/merge` | `sessionRequired`; validates primary and secondary contact ownership | `packages/platform-core/src/csv-transfer.mjs` | Re-links all opportunities, appointments, and messages to primary ID | **VERIFIED** |
| **Kanban Opportunity Move** | `pages/Opportunities.tsx` | `PUT /api/crm/opportunities/:id` | `sessionRequired`; checks pipeline stage validity | `apps/api/server.mjs:L2830` | `opportunities` table + triggers `opportunity.stage_changed` workflow trigger | **VERIFIED** |
| **Visual Workflow Execution** | `pages/Workflows.tsx` | `POST /api/workflows/:id/run` | `sessionRequired`; checks user execution permissions | `packages/workflow-engine/src/engine.mjs` | `workflow_executions`, `workflow_step_runs`, outbox queue | **VERIFIED** |
| **Workflow Step Approval Gate** | `pages/Workflows.tsx` | `POST /api/workflows/runs/:runId/approve` | `sessionRequired`; role must be `admin` | `packages/workflow-engine/src/approval-lifecycle.mjs` | Updates approval status, claims lease, resumes execution from paused node | **VERIFIED** |
| **Copilot Swarm Proposal Review** | `pages/CopilotInbox.tsx` | `POST /api/copilot/proposals/:id/execute` | `sessionRequired`; credit check against billing ledger | `packages/platform-core/src/proposal-executor.mjs` | Executes governed mutation, deducts credits, records immutable receipt | **VERIFIED** |
| **Public Appointment Booking** | `pages/PublicBooking.tsx` | `POST /api/calendars/book/:id` | Public ingress; checks calendar availability and double-booking | `apps/api/server.mjs:L2250` | `appointments` table + creates lead contact + triggers calendar sync | **VERIFIED** |
| **Public Funnel Order Bump** | `pages/PublicFunnel.tsx` | `POST /api/funnels/optin/:slug` | Public ingress; tokenizes payment intent | `apps/api/server.mjs:L2340` | `orders`, `contacts`, `payments` tables | **VERIFIED** |
| **Public Website CMS Ingress** | `pages/PublicWebsite.tsx` | `GET /api/websites/public/:slug` | Public ingress; resolves published site & page slug | `apps/api/server.mjs:L2400` | Reads `websites` & `website_pages` + injects global symbols | **VERIFIED** |
| **Omnichannel Message Send** | `pages/Conversations.tsx` | `POST /api/conversations/:id/messages` | `sessionRequired`; checks `consent_records` before SMS/Email | `packages/platform-core/src/consent-policy.mjs` | `messages` table + queues outbound delivery job to outbox worker | **VERIFIED** |
| **WebRTC Softphone Session** | `pages/PhoneSystem.tsx` | `POST /api/telephony/token` | `sessionRequired`; generates scoped HMAC token | `apps/api/server.mjs:L3100` | Returns WebRTC token (`opz_rtc_...`) + STUN/TURN iceServers | **VERIFIED** |
| **A2P 10DLC Carrier Trust Hub** | `pages/PhoneSystem.tsx` | `POST /api/telephony/a2p/register` | `sessionRequired`; validates EIN, business address, sample messages | `apps/api/server.mjs:L3180` | `a2p_registrations` table; submits to carrier sandbox | **VERIFIED** |
| **Snapshot Export & Deploy** | `pages/Snapshots.tsx` | `POST /api/agency/snapshots/:id/deploy` | `sessionRequired`; admin only | `apps/api/routes/agency.mjs:L180` | Clones funnels, workflows, forms, and custom values to target location | **VERIFIED** |
| **Audit Trail CSV Export** | `pages/AuditLog.tsx` | `GET /api/audit?format=csv` | `sessionRequired`; admin only; escapes formula injection | `apps/api/server.mjs:L2980` | Streams sanitized CSV records from immutable audit store | **VERIFIED** |

---

## 4. Storage Reality: Real vs Simulated Features

### A. Genuinely Real and Persisted Capabilities
1. **User Authentication & RBAC:** Scrypt password hashing, session cookies, CSRF protection, agency and location multi-tenant scoping.
2. **CRM Domain Entities:** Contacts, Leads, Opportunities, Pipelines, Stages, Tasks, Smart Lists, Custom Values, and Activity Timelines are completely implemented and persisted.
3. **Visual Workflow Orchestration:** 14 node kinds, AST expressions (`a + b`, ternary operators, member access), approval cycles, durable worker leases, and execution timelines.
4. **Governed Copilot Proposals:** 10-agent routing, RAG context retrieval, proposal sandboxing, credit checks, and authoritative execution.
5. **Relational Database Schemas:** Migrations 001-014 create all relational tables, foreign keys, forced RLS policies, and immutability triggers.

### B. Features Operating in Sandbox / Simulated Mode
1. **Outbound Carrier SMS / Voice (Telephony):** In local development and without live Twilio credentials, the system operates in **Carrier Sandbox Mode**. WebRTC tokens are minted (`opz_rtc_...`), simulated calls progress through state transitions, and DTMF tones are logged. To activate live carrier dispatch, `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` must be configured.
2. **External Payment Settlement (Stripe):** Public checkouts and customer order settlements calculate taxes, apply coupons, and record orders in the database. In test mode, charges use simulated payment tokens. Live credit card processing requires setting `STRIPE_SECRET_KEY` and configuring Stripe Connect webhooks.
3. **Media Cloud Storage (S3 / R2):** Uploaded files at `/api/media/upload` are stored in memory or on the local filesystem. Production deployment requires wiring an S3/Cloudflare R2 bucket.
4. **Outbound Email Dispatch (SendGrid / Resend):** Campaign test-sends and transactional notifications produce valid delivery events in the system outbox. Sending real emails over the public internet requires setting `SMTP_URL` or `RESEND_API_KEY`.

---

## 5. Architectural Correctness & Data Integrity

1. **Transaction Boundaries:** In PostgreSQL mode, multi-step operations (e.g. Contact Merge, Snapshot Deploy, Copilot Proposal Execution) execute within explicit `BEGIN ... COMMIT` database transactions, rolling back completely on errors.
2. **Formula Injection Sanitization:** Implemented in `csv-transfer.mjs` and verified in `crm.mjs`; all user-supplied spreadsheet cells starting with `=`, `+`, `-`, or `@` are prefixed with `'` to prevent CSV code execution in Excel/Google Sheets.
3. **SSRF Defense:** External webhook triggers and zapier hook dispatches pass through `ssrf-defense.mjs`, which resolves DNS records and blocks all private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1`, `::1`, and AWS metadata `169.254.169.254`).
