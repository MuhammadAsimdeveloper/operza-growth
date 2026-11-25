# Phase 3 Completion Report — Real Channels & Real Money

**Date:** 2026-11-25
**Branch:** `feat/operza-agency-launch-readiness`
**Baseline Commit:** `cd1cdbb677f411310371b5b354ed94eef859cf75`

---

## 1. Summary of Architecture Delivered

1. **Additive Migration (`packages/db/migrations/036_phase3_provider_billing_dunning.sql`)**:
   - Created `stripe_connect_accounts`, `payment_links`, `coupons`, and `dunning_attempts` tables with composite `(agency_id, location_id, id)` primary keys, `FORCE ROW LEVEL SECURITY`, idempotency unique indexes, and least-privilege `operza_app`/`operza_worker` grants.

2. **Stripe Connect & Payment Adapter (`packages/platform-core/src/provider-adapters.mjs`, `apps/api/routes/payments.mjs`)**:
   - Upgraded `stripePaymentAdapter` (`verify`, `createConnectAccount`, `createPaymentIntent`, `createRefund`) with `sk_test_`/`sk_live_` credential validation, `Idempotency-Key` headers, injectable `fetchFn` for deterministic sandbox testing, and explicit `sandbox` vs `production` mode classification.
   - Added `GET /api/payments/stripe/status` reporting truthful account readiness (`not_configured`, `onboarding_pending`, `sandbox_connected`, `production_connected`).

3. **Messaging Provider Webhooks & Compliance (`apps/api/server.mjs`)**:
   - Added `POST /api/webhooks/twilio/status` with `x-twilio-signature` HMAC-SHA1 verification, fail-closed production check, replay protection, and delivery status updates (`queued`, `processing`, `sent`, `delivered`, `failed`, `read`).
   - Added `POST /api/webhooks/sendgrid/events` with replay protection and automatic email consent revocation on `spamreport`/`unsubscribe`.
   - Preserved truthful `SUBMITTED_MANUAL_REVIEW` A2P 10DLC status outside test mode.

4. **Server-Side Branded Invoice PDFs (`packages/db/lib/invoice-pdf.mjs`, `apps/api/routes/payments.mjs`)**:
   - Added `generateInvoicePdf()` producing valid `%PDF-1.4` documents from authoritative persisted minor-unit invoice data.
   - Added `GET /api/invoices/:id/pdf` gated by `invoices:read` scope and `TenantTx` ownership.

5. **Payment Links, Coupons & Durable Dunning (`packages/db/lib/`)**:
   - Added `payment-links-repository.mjs`, `coupons-repository.mjs` (enforcing `max_uses` and expiry), and `dunning-repository.mjs` (idempotent retry scheduling, exponential backoff, non-retryable failure classification `fraudulent`/`stolen_card`/`expired_card`).
   - Added `POST /api/payments/dunning/schedule` and `api.billing` client helpers in `apps/web/src/lib/api.ts`.

---

## 2. Provider Readiness Matrix

| Provider | Sandbox / Test Verified | Production Credentials Required | Approval / Notes |
| --- | --- | --- | --- |
| **Stripe** | Yes (`stripePaymentAdapter` + HMAC webhook + refund bounds) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Connect onboarding required for live payouts |
| **Twilio SMS** | Yes (`twilioSmsAdapter` + inbound/status HMAC webhooks + STOP) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | A2P 10DLC (`SUBMITTED_MANUAL_REVIEW` in prod) |
| **SendGrid / Resend** | Yes (`sendgridEmailAdapter`, `resendEmailAdapter`, `/events` webhook) | `SENDGRID_API_KEY` / `RESEND_API_KEY` | Domain SPF/DKIM verification required |
| **WhatsApp (Meta Cloud)** | Yes (`whatsappMetaAdapter` + webhook) | Meta Cloud API token & Phone ID | Meta template approval required |
