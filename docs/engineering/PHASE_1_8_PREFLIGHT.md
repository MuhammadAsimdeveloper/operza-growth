# Phase 1.8 Preflight — Messaging, Conversations & Communication Consents

**Date:** 2026-11-25
**Repository:** `MuhammadAsimdeveloper/operza-growth` (`C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`)
**Branch:** `feat/operza-agency-launch-readiness`
**Baseline HEAD:** `e323d673b1e8a46141a66fe3acc1ff138d6c95c4` (`refactor(billing): extract orders payments invoices and ledger domains`)

---

## 1. Phase 1.7 Baseline Verification Summary
- Domain unit tests: `35/35` passing (`exit 0`)
- PostgreSQL CI verification (`node scripts/verify-ci-postgres.mjs`): `130/130` passing, 33 migrations applied (`exit 0`)
- E2E suite (`node scripts/test-e2e.mjs`): `116/116` passing (`exit 0`)
- Web TypeScript check (`npm --workspace=@operza/web run typecheck`): `exit 0`
- Web build (`npm --workspace=@operza/web run build`): `12` routes prerendered (`exit 0`)
- SEO audit (`node scripts/seo-audit/run-seo-checks.mjs`): `106/106` passing (`exit 0`)

---

## 2. Current Messaging & Consent Architecture Audit

### Existing Relational Schema
- `communication_consents` already exists in `packages/db/migrations/008_platform_foundation.sql` with:
  - Composite primary key `(agency_id, location_id, id)`
  - `channel IN ('email', 'sms', 'whatsapp')`
  - `purpose IN ('transactional', 'marketing', 'appointment', 'review_request')`
  - `status IN ('granted', 'revoked')`
  - `source IN ('web_form', 'api', 'keyword_opt_out', 'manual', 'import')`
  - `FORCE ROW LEVEL SECURITY` and `operza_app`/`operza_worker` grants (Migrations 008, 022-025).
- `conversations` and `messages` currently have **no dedicated SQL tables** (living in `state.records.conversations` / `location_records`).

### Existing Routes & Inline Logic in `apps/api/server.mjs`
- `POST /api/conversations/:id/messages` (lines 5856-5888): appends outbound agent message to `state.records.conversations`, broadcasts `crm.conversation.message`. Currently lacks relational `TenantTx` persistence and consent/opt-out verification before outbound dispatch.
- `GET /api/platform/consents`, `POST /api/platform/consents`, `POST /api/platform/consents/:id/revoke` (lines 7875-7965): delegates to `platformRepository` when `pgPool` is available, with in-memory fallback.
- `POST /api/webhooks/twilio` (lines 4086-4265): HMAC-SHA1 signature verification, replay guard, inbound SMS contact/conversation upsert, workflow trigger. Needs `STOP`/`UNSUBSCRIBE` keyword opt-out auto-recording to `communication_consents` (`status: 'revoked'`, `source: 'keyword_opt_out'`).
- `POST /api/webhooks/sendgrid` (lines 4269-4362), `GET/POST /api/webhooks/whatsapp` (lines 4365-4467), `GET/POST /api/webhooks/meta` (lines 4470-4568): inbound email, WhatsApp, and Meta conversation/message ingestion.
- Workflow actions `crmActions.sendEmail`, `crmActions.sendSms`, `crmActions.sendWhatsApp` (lines 1752-1884): channel configuration honesty guards + conversation append.

---

## 3. Target Phase 1.8 Design

1. **Additive Migration `034_conversations_and_messages.sql`**:
   - Create `conversations` table (`agency_id`, `location_id`, `id`, `contact_id`, `contact_name`, `channel`, `subject`, `status`, `assigned_to`, `last_message`, `last_message_at`, `metadata`, `created_at`, `updated_at`) with `FORCE ROW LEVEL SECURITY` and tenant policy.
   - Create `messages` table (`agency_id`, `location_id`, `id`, `conversation_id`, `contact_id`, `channel`, `direction`, `sender_type`, `sender_name`, `subject`, `body`, `delivery_status`, `provider`, `provider_message_id`, `idempotency_key`, `error_code`, `metadata`, `sent_at`, `delivered_at`, `created_at`) with `FORCE ROW LEVEL SECURITY`, valid `delivery_status` check (`queued`, `processing`, `sent`, `delivered`, `failed`, `read`, `cancelled`), and unique partial index on `(agency_id, location_id, provider, provider_message_id)` for idempotent webhook/status ingestion.
   - Grant least-privilege permissions to `operza_app` and `operza_worker`.

2. **Tenant-Scoped Repositories (`packages/db/lib/`)**:
   - `conversations-repository.mjs` (`createConversationsRepository`): `listConversations`, `getConversation`, `createConversation`, `findOrCreateConversation`, `updateConversation`, `appendMessage` (with idempotent `providerMessageId`/`idempotencyKey` handling), `updateMessageDeliveryStatus` (by `id` or `providerMessageId`), `listMessages`.
   - `communication-consents-repository.mjs` (`createCommunicationConsentsRepository`): `recordConsent`, `listConsents`, `getLatestConsent`, `revokeConsent`, `isChannelAllowed` (fail-closed / explicit opt-out suppression check).
   - Export both from `packages/db/lib/database.mjs`.

3. **Modular API Router (`apps/api/routes/conversations.mjs`)**:
   - `handleConversationsRoutes(req, res, ctx)` handling:
     - `/api/crm/conversations` and `/api/crm/conversations/:id` (GET, POST, PATCH/PUT, DELETE)
     - `/api/conversations/:id/messages` (GET, POST with consent enforcement before outbound dispatch, explicit `queued`/`sent` vs `delivered` honesty)
     - `/api/platform/consents` (GET, POST) and `/api/platform/consents/:id/revoke` (POST)
     - Inbound/status webhook helpers or routes (`/api/webhooks/twilio`, `/api/webhooks/sendgrid`, `/api/webhooks/whatsapp`, `/api/webhooks/meta`) preserving fail-closed signature & replay checks plus `STOP`/`UNSUBSCRIBE` keyword opt-out auto-revocation.
   - Wire into `apps/api/routes/crm.mjs` and `apps/api/server.mjs` with API key scope checks (`conversations:read`, `conversations:write`, `consents:read`, `consents:write`).

4. **Consent Enforcement & Delivery Honesty**:
   - Outbound message dispatch (`POST /api/conversations/:id/messages`) checks `CommunicationConsentsRepository.isChannelAllowed` (or in-memory consent state) and rejects/suppresses when revoked (`403 ConsentRevoked`).
   - Queued/simulated outbound messages are never marked `delivered` without an explicit provider delivery callback.
