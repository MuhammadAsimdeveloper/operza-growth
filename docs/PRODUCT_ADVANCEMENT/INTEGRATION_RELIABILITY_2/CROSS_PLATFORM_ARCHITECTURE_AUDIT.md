# Cross-Platform Integration & End-to-End Reliability 2.0 — Architecture Audit

**Stage:** Product Advancement Stage 16 — Cross-Platform Integration & End-to-End Reliability 2.0
**Branch:** `feat/operza-agency-launch-readiness`
**Starting Commit:** `2e08152`

---

## 1. Existing Working Integrations
1. **PostgreSQL TenantTx & FORCE RLS**: All core tables (`001`–`051`) enforce composite `(agency_id, location_id, id)` keys and `FORCE ROW LEVEL SECURITY` via `runInTenantTx`.
2. **Durable Outbox & Action Receipts**: `outbox-producer.mjs`, `outbox-worker.mjs`, `durable-worker.mjs`, and `workflow_action_receipts` (`031`, `032`) provide idempotent workflow execution and provider lease fencing.
3. **CRM -> Unified Inbox -> Customer 360**: `conversations`, `messages`, `engagement_conversation_notes`, `support_tickets`, and `location_records` (`contacts`, `opportunities`, `appointments`, `invoices`) share `contact_id` / `conversation_id` within tenant scope.
4. **Customer Portal 2.0**: Agency-scoped magic links, hashed sessions, profile field allowlists, and `filterCustomerVisibleMessages` enforce customer isolation.

---

## 2. Identified Cross-Module Gaps & Fixes for Stage 16
1. **Medium — Missing Unified Event Contract Registry**: CRM, Support, Engagement, Commerce, Workflows, and Portal emit events with varying shapes. **Fix:** Introduce `packages/platform-core/src/cross-platform-events.mjs` defining canonical entity ownership, schema-versioned (`2.0`) event envelopes, deterministic idempotency keys, secret redaction, and loop-depth protection (`loopDepth <= 3`) over the existing outbox.
2. **Medium — Analytics 2.0 `!pgPool` 503 Gap**: `apps/api/routes/analytics2.mjs` returns `503 PG_REQUIRED` in local JSON-store mode. **Fix:** Add an honest in-memory aggregation fallback computing real counts from `state` (respecting invoice status/currency).
3. **Medium — Integration Health Diagnostics**: `apps/api/routes/integrations2.mjs` lacks a unified `/health` diagnostic view distinguishing `connected`, `not_configured`, `authorization_required`, `approval_pending`, `disconnected`, `degraded`, `test_adapter_only`, and `disabled` without leaking secrets. **Fix:** Add `GET /api/integrations/v2/health`.
4. **Low — Cross-Module UI Links**: `SupportInbox2Panel.tsx` displays Customer 360 data but lacks a direct link to `/contacts/:id`; `ContactDetail.tsx` lacks a quick link to open `/conversations` from Customer 360. **Fix:** Add safe `Link` navigation in both views.
5. **High — End-to-End Multi-Module Verification Gap**: Prior stages tested individual domains in isolation. **Fix:** Build `packages/platform-core/test/cross-platform-reliability-2-0.test.mjs` exercising Journeys A–H, partial failure recovery, and cross-tenant PostgreSQL/RLS isolation.
