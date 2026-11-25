# Monolith Retirement Inventory (`apps/api/server.mjs`)

**Date:** 2026-11-25
**Target File:** `apps/api/server.mjs`

| Method(s) | Path Pattern | Classification | Target Module / Owner | Auth & Tenant | Status |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/robots.txt`, `/sitemap.xml` | Shared public SEO | `server.mjs` / `system.mjs` | Public | Retained in bootstrap |
| `GET` | `/health`, `/ready`, `/metrics` | Shared operational | `apps/api/routes/system.mjs` | Public / Ops | Delegated |
| `POST/GET` | `/api/auth/*` | Auth boundary | `apps/api/routes/auth.mjs` | Public + Session | Delegated |
| `GET/POST/PUT/DELETE` | `/api/crm/contacts*`, `/api/contacts*` | Domain (Contacts) | `apps/api/routes/contacts.mjs` | Session/API Key + TenantTx | Delegated |
| `GET/POST/PUT/DELETE` | `/api/crm/opportunities*`, `/api/opportunities*` | Domain (Opportunities) | `apps/api/routes/opportunities.mjs` | Session/API Key + TenantTx | Delegated |
| `GET/POST/PUT/DELETE` | `/api/crm/calendars*`, `/api/crm/appointments*`, `/api/calendars/*` | Domain (Scheduling) | `apps/api/routes/scheduling.mjs` | Public/Session + TenantTx | Delegated |
| `GET/POST/PUT/DELETE` | `/api/crm/workflows*`, `/api/workflows*` | Domain (Workflows) | `apps/api/routes/workflows.mjs` | Session/API Key + TenantTx | Delegated |
| `GET/POST/PUT/DELETE` | `/api/crm/pipelines*`, `/api/pipelines*` | Domain (Pipelines) | `apps/api/routes/pipelines.mjs` | Session/API Key + TenantTx | Delegated |
| `GET/POST/PUT/DELETE` | `/api/crm/websites*`, `/api/crm/funnels*`, `/api/funnels/*`, `/api/websites/*` | Domain (Funnels) | `apps/api/routes/funnels.mjs` | Public/Session + TenantTx | Delegated |
| `GET/POST/PUT/DELETE` | `/api/crm/orders*`, `/api/orders*`, `/api/invoices*`, `/api/payments*`, `/api/ledger/*`, `/api/webhooks/stripe` | Domain (Billing/Ledger) | `apps/api/routes/payments.mjs` | Public/Webhook/Session + TenantTx | Delegated |
| `GET/POST/PATCH/DELETE` | `/api/crm/conversations*`, `/api/conversations/*/messages`, `/api/platform/consents*` | Domain (Messaging/Consent) | `apps/api/routes/conversations.mjs` | Session/API Key + TenantTx | Delegated |
| `GET/POST/PUT/DELETE` | `/api/crm/forms*`, `/api/forms/*/publish`, `/api/forms/*/submissions`, `/api/forms/public/*`, `/api/forms/submit/*` | **Domain (Forms)** | `apps/api/routes/forms.mjs` | Public/Session + TenantTx | **Extracting in Phase 1.9** |
| `GET/POST/PUT/PATCH/DELETE` | `/api/crm/tasks*`, `/api/tasks*` | **Domain (Tasks)** | `apps/api/routes/tasks.mjs` | Session/API Key + TenantTx | **Extracting in Phase 1.9** |
| `GET/POST/PUT/PATCH/DELETE` | `/api/crm/reviews*`, `/api/reviews/requests*`, `/api/reviews/public/*`, `/api/reviews/submit/*` | **Domain (Reviews)** | `apps/api/routes/reviews.mjs` | Public/Session + TenantTx | **Extracting in Phase 1.9** |
| `GET/POST/PUT/DELETE` | `/api/agency/*` (lines 7958–8560, 9101–9155) | **Shadowed duplicate agency handlers** | `apps/api/routes/agency.mjs` | Session + Agency Role | **Retiring duplicates in Phase 1.9** |
| `POST` | `/api/webhooks/twilio`, `/api/webhooks/sendgrid`, `/api/webhooks/whatsapp`, `/api/webhooks/meta` | Webhook ingress | `server.mjs` (delegating consent/workflow) | Signature / Fail-closed | Retained webhook ingress |
| `GET/POST` | `/api/widget/*`, `/hosted/*`, `/live/*`, `/api/media/*`, `/api/qr/*`, `/api/portal/*`, `/api/v1/zapier/*`, `/api/ai/*`, `/api/developers/*` | Platform / Copilot / Zapier / Portal | `server.mjs` | Mixed | Shared/Platform modules |
