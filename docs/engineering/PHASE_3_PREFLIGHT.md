# Phase 3 Preflight — Real Channels & Real Money

**Date:** 2026-11-25
**Repository:** `MuhammadAsimdeveloper/operza-growth` (`C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`)
**Branch:** `feat/operza-agency-launch-readiness`
**Baseline HEAD:** `cd1cdbb677f411310371b5b354ed94eef859cf75` (`feat(web): rebuild frontend on TanStack Query typed API client and shared UI package`)
**Working Tree:** Clean, `[ahead 8]` relative to `origin/feat/operza-agency-launch-readiness`

---

## 1. Phase 2 Audit Summary
- `seed.ts` is completely removed from production `store.tsx` (`createEmptyWorkspaceState()`).
- Core Workspace (`AppShell.tsx`, `Dashboard.tsx`, `Contacts.tsx`, `Opportunities.tsx`, `Tasks.tsx`, `Orders.tsx`) uses TanStack Query + tenant-scoped `queryKeys` + `@operza/ui` + `ApiError`.
- Secondary pages still calling `useStore()` rely on `createEmptyWorkspaceState()` (zero fake seed records).

---

## 2. Existing Provider & Financial Architecture Audit
- **Provider Adapters (`packages/platform-core/src/provider-adapters.mjs`)**:
  - `resendEmailAdapter` (`email.resend`), `sendgridEmailAdapter` (`email.sendgrid`), `twilioSmsAdapter` (`sms.twilio`), `whatsappMetaAdapter` (`whatsapp.meta_cloud`), `zapierWebhookAdapter` (`zapier`) are implemented with injectable `fetchFn` and consent checks.
  - `stripePaymentAdapter` (`payments.stripe`) is currently a stub (`PAYMENTS_DISABLED_PENDING_COMPLIANCE`).
- **Financial Repositories (`packages/db/lib/`)**:
  - `orders-repository.mjs`, `payments-repository.mjs`, `invoices-repository.mjs`, `ledger-repository.mjs`, `money.mjs` (integer minor units, idempotency keys, `provider_event_id` deduplication, append-only ledger, `FORCE ROW LEVEL SECURITY`).
- **Messaging & Consents (`packages/db/lib/`)**:
  - `conversations-repository.mjs`, `communication-consents-repository.mjs` (Migration 008 + 034).
- **A2P 10DLC (`apps/api/server.mjs` lines 6709-6805)**:
  - `GET /api/telephony/a2p/status` and `POST /api/telephony/a2p/register` return `SUBMITTED_MANUAL_REVIEW` outside test mode.

---

## 3. Phase 3 Implementation Scope
1. **Additive Migration `036_phase3_provider_billing_dunning.sql`**:
   - `payment_links` & `coupons` tenant-scoped tables (with `FORCE ROW LEVEL SECURITY`, usage limits, expiry, unique code/slug per tenant) to close the Phase 1.7 backlog.
   - `dunning_attempts` table (with `FORCE ROW LEVEL SECURITY`, idempotency key, retry count, next retry timestamp, terminal status) for durable payment retry scheduling.
   - `stripe_connect_accounts` table (with `FORCE ROW LEVEL SECURITY`, `charges_enabled`, `payouts_enabled`, `details_submitted`, `onboarding_status`).
2. **Stripe Connect & Real Checkout/Refunds (`stripePaymentAdapter` + `apps/api/routes/payments.mjs`)**:
   - Upgrade `stripePaymentAdapter` (`verify`, `createConnectAccount`, `createPaymentIntent`, `createRefund`) using real Stripe REST API (`https://api.stripe.com/v1/...`) with injectable `fetchFn` and `Idempotency-Key`.
   - Stripe Connect onboarding & status endpoints (`/api/payments/stripe/connect`, `/api/payments/stripe/status`) distinguishing `not_configured`, `onboarding_pending`, `sandbox_connected`, `production_connected`.
   - Webhook handler `POST /api/webhooks/stripe`: raw body HMAC-SHA256 `stripe-signature` verification with 300s timestamp tolerance, replay protection, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded` ledger reconciliation.
3. **Provider Delivery Webhooks (Twilio, SendGrid, WhatsApp)**:
   - `POST /api/webhooks/twilio/status` (with `x-twilio-signature` HMAC-SHA1 verification) updating `messages.delivery_status` (`queued` -> `sent` -> `delivered` / `undelivered` / `failed`).
   - `POST /api/webhooks/sendgrid/events` (event webhook processing `delivered`, `bounce`, `spamreport`, `unsubscribe` -> updating message delivery status & recording consent revocation on spam/unsubscribe).
   - `POST /api/webhooks/whatsapp` status callback handling (`sent`, `delivered`, `read`, `failed`).
4. **Server-Side Branded Invoice PDF Generation (`packages/db/lib/invoice-pdf.mjs` + `GET /api/invoices/:id/pdf`)**:
   - Deterministic, dependency-free valid PDF 1.4 generator (`%PDF-1.4`) rendering authoritative persisted invoice number, issuer/agency branding, customer details, line items, discounts, tax, minor-unit-accurate totals, and payment status, gated by `TenantTx` ownership.
5. **Durable Dunning & Payment Retries (`packages/db/lib/dunning-repository.mjs` + `/api/payments/dunning/*`)**:
   - Idempotent retry scheduling, exponential backoff, max retry cap, non-retryable failure classification (`card_declined_stolen`, `fraudulent`, `expired_card` vs retryable `insufficient_funds`, `processing_error`), and terminal cancellation.
6. **Payment Links & Coupons Repositories (`packages/db/lib/payment-links-repository.mjs`, `coupons-repository.mjs`)**:
   - Tenant-scoped PostgreSQL persistence with expiry, usage limits, and duplicate redemption prevention.
7. **Frontend Provider & Invoice PDF UI**:
   - Truthful provider state badges (`not_configured`, `sandbox_connected`, `production_connected`, `approval_pending`, etc.) and Invoice PDF download link in `apps/web`.
