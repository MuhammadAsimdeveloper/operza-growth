# Operza Growth — Commerce & Subscription Management 2.0 Architecture Audit

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `c3d2902`

---

## 1. Existing Commerce, Billing & Subscription Assessment

### 1.1 Money & Financial Ledger (`money.mjs`, `ledger-repository.mjs`, Migrations `013` & `033`)
- **Implemented & Verified:** Integer minor-unit conversion (`toCents`, `fromCents`, `validateCurrency`), append-only hash-chained `billing_ledger_entries` (`sha256` checksum), `idempotency_key` deduplication, `FOR UPDATE` account locking, and overdraft checks.
- **Gaps:** Lacks a cryptographic `verifyLedgerChain` utility, an explicit offsetting `reverseTransaction` workflow, and automated cross-entity reconciliation (`payments` vs `invoices` vs `billing_ledger_entries`).

### 1.2 Orders, Products, Payments, Invoices & Coupons
- **Implemented & Verified:** `orders-repository.mjs`, `payments-repository.mjs`, `invoices-repository.mjs`, `coupons-repository.mjs` (atomic `uses_count < max_uses`), `dunning-repository.mjs`, `stripePaymentAdapter` (`provider-adapters.mjs` with `Idempotency-Key`).
- **Gaps:**
  - No `commerce_products` table with server-side minor-unit pricing and tax classification metadata.
  - No `commerce_refunds` table with cumulative refund cap validation (`cumulative <= captured`), approval gating, and ledger reversal linkage.
  - `coupons` lacks currency-specific fixed discount validation, `min_order_cents`, and per-customer redemption tracking (`commerce_coupon_redemptions`).
  - No durable `commerce_webhook_events` deduplication/out-of-order log for recurring Stripe billing events.

### 1.3 SaaS Subscriptions & Entitlements (`saas-subscriptions-repository.mjs`, `entitlements.mjs`, Migration `039`)
- **Implemented & Verified:** Server-side entitlement resolution (`resolveEntitlements`, `assertFeatureEntitled`, `assertSeatLimit`), grace period handling for `past_due`, and `trialing` expiration checks.
- **Gaps:** Lacks explicit subscription state transition validation, `cancel_at_period_end` / `billing_interval` / `paused_at` lifecycle tracking, and `saas_subscription_events` audit history.

### 1.4 Frontend Billing UI (`Payments.tsx`, `PlanUsage.tsx`)
- **Gaps:** `Payments.tsx` still syncs into legacy `useStore()` and lacks unified views for Commerce Overview, Orders, Products, Coupons, Subscriptions, Dunning, Ledger verification, and Reconciliation.
