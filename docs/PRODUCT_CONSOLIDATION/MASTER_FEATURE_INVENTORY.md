# Stage 8 — Master Feature Inventory

**Date:** 2026-11-27  
**Baseline Commit:** `044f203`

Legend:
- **FIT**: Fully Implemented & Tested (Backend + API + Frontend + DB/RLS + Tests)
- **INV**: Implemented, Not Fully Verified (e.g., requires live staging Redis/ClamAV/providers)
- **PART**: Partially Implemented (gap between backend/API/UI or synchronous where async is needed)
- **BLK**: Blocked by External Infrastructure (AWS/DNS/ACME/live provider keys/pen-test)
- **DEF**: Known Defect (confirmed failure in tests or live UI)

---

## 1. Core Platform
| Feature | Backend | API | Frontend | Tenant/RLS | Status | Notes |
|---|---|---|---|---|---|---|
| Signup / Login / Sessions | Yes | `auth.mjs` | `Login.tsx`, `Signup.tsx` | PostgreSQL authoritative | **FIT** | Argon2id/scrypt + HMAC session cookie + CSRF |
| Magic-Link / OTP Auth | Yes | `auth.mjs` | `Login.tsx` | Rate-limited | **DEF** | `phase-2b-independent-verification.test.mjs` test `3.1` fails due to `429` vs `400` expectation |
| Agency & Location Management | Yes | `agency.mjs` | `SubAccounts.tsx` | `TenantTx` + `FORCE RLS` | **FIT** | Cache purged on `switchLocation` & `logout` |
| Users, Roles & Permissions | Yes | `agency.mjs` | `Settings.tsx` | RBAC + API scopes | **FIT** | `checkScope` & role checks enforced server-side |
| SaaS Entitlements & Plan Usage | Yes | `phase7.mjs` | `PlanUsage.tsx` | `saas_subscriptions` | **DEF** | `/plan-usage` crashes on `undefined.toLocaleString()` (`PlanUsage.tsx:301`) |
| Billing & Ledger | Yes | `payments.mjs` | `Payments.tsx` | `ledger_entries` (`FORCE RLS`) | **INV** | Ledger & Stripe adapter fail closed; live Stripe charging disabled pending compliance |
| Audit Logs | Yes | `system.mjs` | `AuditLog.tsx` | `immutable_audit_events` | **FIT** | Hash-chained audit log |

## 2. CRM
| Feature | Backend | API | Frontend | Tenant/RLS | Status | Notes |
|---|---|---|---|---|---|---|
| Contacts CRUD & Search | `contacts-repository.mjs` | `contacts.mjs` | `Contacts.tsx` | `FORCE RLS` + trigram idx | **FIT** | E2E & PG tested |
| Customer 360° Profile | `crm-2-repository.mjs` | `crm2.mjs` | `ContactDetail.tsx` | `TenantTx` | **FIT** | Aggregated timeline, deals, tasks, appointments |
| Duplicate Detection & Merge | `crm-2-repository.mjs` | `crm2.mjs` | `ContactDetail.tsx` | `FOR UPDATE` + audit | **FIT** | Re-links child records transactionally |
| Smart Lists (AST) | `crm-2-repository.mjs` | `crm2.mjs` | `SmartLists.tsx` | `TenantTx` | **PART** | Returns `503` in `!pgPool` JSON mode; works in PostgreSQL |
| Custom Fields | `crm-2-repository.mjs` | `crm2.mjs` | `CustomValues.tsx` | `FORCE RLS` | **FIT** | 7 typed field validators |
| CSV Import / Export | `crm-2-0.mjs` | `crm2.mjs` | `Contacts.tsx` | `TenantTx` | **PART** | Dry-run preview works; large CSV imports run synchronously |
| Opportunities & Pipelines | `opportunities-repository.mjs`, `pipelines-repository.mjs` | `opportunities.mjs`, `pipelines.mjs` | `Opportunities.tsx` | `FORCE RLS` | **FIT** | Kanban + stage velocity |
| Tasks, Forms, Reviews, Conversations | `*-repository.mjs` | `tasks.mjs`, `forms.mjs`, `reviews.mjs`, `conversations.mjs` | Dedicated pages | `FORCE RLS` | **FIT** | Consent enforcement & idempotent submissions |

## 3. Automation
| Feature | Backend | API | Frontend | Tenant/RLS | Status | Notes |
|---|---|---|---|---|---|---|
| Legacy Workflows CRUD (`/api/crm/workflows`) | `workflows-repository.mjs` | `workflows.mjs` | `Workflows.tsx` | `FORCE RLS` | **DEF** | `!pgPool` fallback drops `body.actions` & `body.trigger` (`release-verification-gaps.test.mjs` 3 & 4) |
| Node Registry V2, Branches, Loops, Waits | `packages/workflow-engine` | `workflows2.mjs` | `WorkflowGraphV2.tsx` | `FORCE RLS` | **FIT** | 79/79 workflow-engine tests pass; zero-eval data ops |
| Immutable Versioning & Rollback | `workflows-2-repository.mjs` | `workflows2.mjs` | `WorkflowGraphV2.tsx` | Optimistic lock `409` | **FIT** | Tested under real PG |
| DST-Safe Scheduling & Approvals | `scheduler-v2.mjs`, `approval-lifecycle.mjs` | `workflows.mjs`, `workflows2.mjs` | `Workflows.tsx` | `FORCE RLS` | **FIT** | Self-approval & cross-tenant blocked |
| Multi-Worker Redis Queue | `outbox-repository.mjs` | `worker` | N/A | `operza_worker` | **BLK** | No Redis/Docker on local host |

## 4. Integrations
| Feature | Backend | API | Frontend | Tenant/RLS | Status | Notes |
|---|---|---|---|---|---|---|
| Connector SDK 2.0 & OAuth PKCE | `connector-sdk-v2.mjs`, `oauth-lifecycle-v2.mjs` | `integrations2.mjs` | `IntegrationsHub2Panel.tsx` | `FORCE RLS` | **FIT** | Vault secret refs stripped from API responses |
| Webhook Platform 2.0 & Sync Engine | `webhook-platform-v2.mjs`, `sync-engine-v2.mjs` | `integrations2.mjs` | `IntegrationsHub2Panel.tsx` | `UNIQUE` dedup | **FIT** | Timestamped HMAC + SSRF defense |
| Calendar 2-Way Sync | `calendar-sync.mjs` | `scheduling.mjs` | `Calendars.tsx` | `TenantTx` | **DEF** | `calendar-sync.test.mjs` fixture date stale; `executeCalendarSync` missing `CALENDAR_AUTH_FAILED` wrap on `verify` throw |
| Live Third-Party Connectors | Provider adapters | `integrations2.mjs` | `Integrations.tsx` | Vault | **BLK** | Live provider credentials intentionally unconfigured |

## 5. AI
| Feature | Backend | API | Frontend | Tenant/RLS | Status | Notes |
|---|---|---|---|---|---|---|
| Model Router, Orchestrator, Memory, RAG V2, Evals | `packages/platform-core/src/ai/` | `ai2.mjs` | `AiStudio2Panel.tsx` | `user` vs `agency` RLS | **FIT** | Magic-byte MIME checks, bounded delegation depth 3 |
| Live LLM / Voice Streaming | `ai-providers.mjs` | `ai.mjs` | `CopilotHub.tsx`, `PhoneSystem.tsx` | Consent + budget | **BLK** | Paid external LLM & Twilio Media Streams disabled locally |

## 6. Marketplace
| Feature | Backend | API | Frontend | Tenant/RLS | Status | Notes |
|---|---|---|---|---|---|---|
| Publisher Portal, Manifests, Releases, Reviews | `marketplace-2-0.mjs`, `marketplace-2-repository.mjs` | `marketplace2.mjs` | `MarketplaceHub2Panel.tsx` | `FORCE RLS` | **FIT** | Scope escalation consent + self-review forbidden |
| Live Marketplace Billing/Payouts | N/A | Deferred | N/A | N/A | **BLK** | Deferred pending Stripe Connect & legal compliance |

## 7. Analytics & BI
| Feature | Backend | API | Frontend | Tenant/RLS | Status | Notes |
|---|---|---|---|---|---|---|
| Metric Catalog V2, Safe Query Builder, Currency Financials, Exports | `analytics-2-0.mjs`, `analytics-2-repository.mjs` | `analytics2.mjs` | `BiStudio2Panel.tsx` | `FORCE RLS` | **FIT** | Integer minor units (`amount_cents`), CSV formula defense, PII redaction |
| Scheduled Report Email Delivery | `analytics-2-repository.mjs` | `analytics2.mjs` | `BiStudio2Panel.tsx` | `TenantTx` | **PART** | Delivery requires staging worker + live email provider |

## 8. Other Product Areas
| Feature | Backend | API | Frontend | Status | Notes |
|---|---|---|---|---|---|
| Sites, Funnels, Domains, Calendar, Orders, Invoices, Coupons, Reviews | `*-repository.mjs` | `funnels.mjs`, `domains.mjs`, `scheduling.mjs`, `payments.mjs`, `reviews.mjs` | Dedicated pages | **FIT / BLK** | E2E `116/116` covers core flows; live DNS/ACME & ClamAV blocked on staging infra |
| Marketing Website (`apps/marketing`) | Astro static | N/A | Astro + React | **FIT** | `5` pages build cleanly; `106/106` SEO checks pass |
