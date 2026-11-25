# Phase 1.8 Completion Report — Messaging, Conversations & Communication Consents

**Date:** 2026-11-25
**Branch:** `feat/operza-agency-launch-readiness`
**Baseline Commit:** `e323d673b1e8a46141a66fe3acc1ff138d6c95c4`

---

## 1. Summary of Changes

1. **Additive Relational Schema (`packages/db/migrations/034_conversations_and_messages.sql`)**:
   - Created `conversations` and `messages` tables with composite tenant primary keys `(agency_id, location_id, id)` and `FORCE ROW LEVEL SECURITY` scoped to `app.agency_id` and `app.location_id`.
   - Enforced `delivery_status` constraints (`queued`, `processing`, `sent`, `delivered`, `failed`, `read`, `cancelled`) and added unique partial indexes on `(agency_id, location_id, provider, provider_message_id)` and `(agency_id, location_id, idempotency_key)` for idempotent webhook/retry ingestion.
   - Granted least-privilege permissions to `operza_app` and `operza_worker`.

2. **Tenant-Scoped Domain Repositories (`packages/db/lib/`)**:
   - `conversations-repository.mjs` (`createConversationsRepository`): CRUD for conversations, idempotent `appendMessage` (with deduplication on `providerMessageId` / `idempotencyKey`), and `updateMessageDeliveryStatus`.
   - `communication-consents-repository.mjs` (`createCommunicationConsentsRepository`): immutable consent audit recording (`recordConsent`), `listConsents`, `revokeConsent`, and `isChannelAllowed` (enforcing channel isolation and opt-out suppression).
   - Exported both from `packages/db/lib/database.mjs`.

3. **Modular API Router & Webhook Opt-Out Integration (`apps/api/routes/conversations.mjs`, `crm.mjs`, `server.mjs`)**:
   - Extracted `/api/crm/conversations*`, `/api/conversations/:id/messages`, `/api/platform/consents`, and `/api/platform/consents/:id/revoke` into `handleConversationsRoutes`.
   - Enforced pre-dispatch consent check on `POST /api/conversations/:id/messages` (returns `403 ConsentRevoked` if blocked) and preserved honest `queued` delivery status without faking `delivered`.
   - Enforced API key scopes (`conversations:read`, `conversations:write`, `consents:read`, `consents:write`) and stripped client-supplied `agencyId`/`locationId`.
   - Integrated `recordInboundOptOut` into `POST /api/webhooks/twilio` for `STOP`/`STOPALL`/`UNSUBSCRIBE`/`CANCEL`/`END`/`QUIT` keywords.

4. **Architecture Docs**:
   - Updated `docs/engineering/API_ARCHITECTURE_MAP.md` and `docs/engineering/ADR_API_MODULARIZATION.md`.

---

## 2. Verification Results

| Check | Result | Notes |
| --- | --- | --- |
| `node --check` (all modified/new `.mjs`) | PASS (`exit 0`) | Clean syntax |
| `node --test packages/db/test/conversations-and-consents-repositories.test.mjs apps/api/test/conversations-api.test.mjs` | PASS (`4/4`, `exit 0`) | Consent blocking, idempotency, scopes, tenant stripping |
| `node scripts/verify-ci-postgres.mjs` | PASS (`130/130`, `exit 0`) | 34 migrations applied under `operza_migrator`; real PG RLS & `provider_message_id` idempotency verified |
| `node scripts/test-e2e.mjs` | PASS (`116/116`, `exit 0`) | Full E2E suite including Twilio inbound SMS & consent endpoints |
| `npm --workspace=@operza/web run typecheck` | PASS (`exit 0`) | Clean TypeScript check |
| `npm --workspace=@operza/web run build` | PASS (`exit 0`) | 211 modules transformed, prerendered |
| `node scripts/seo-audit/run-seo-checks.mjs` | PASS (`106/106`, `exit 0`) | 100% compliance |
| `git diff --check` | PASS (`exit 0`) | Clean whitespace/EOF check |
