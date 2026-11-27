# Operza Growth — Commerce 2.0 Implementation Plan

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `c3d2902`

1. **Database Migration (`packages/db/migrations/047_commerce_2_0.sql`):**
   - `commerce_products`, `commerce_refunds`, `commerce_coupon_redemptions`, `commerce_webhook_events`, `saas_subscription_events`, and additive `saas_subscriptions` lifecycle columns (`billing_interval`, `cancel_at_period_end`, `current_period_start`, `current_period_end`, `paused_at`).
   - Composite `(agency_id, location_id, id)` PKs, `FORCE ROW LEVEL SECURITY`, and `operza_app` / `operza_worker` grants.
2. **Core Commerce 2.0 Engine (`packages/platform-core/src/commerce-2-0.mjs`):**
   - Payment state machine (`pending`, `requires_action`, `processing`, `succeeded`, `failed`, `cancelled`, `partially_refunded`, `refunded`).
   - Invoice state machine (`draft`, `open`, `partially_paid`, `paid`, `overdue`, `void`) & server-side minor-unit subtotal/discount/tax/total calculator.
   - Refund validator (cumulative refund cap, approval threshold), Coupon 2.0 validator (percentage/fixed, currency match, min order, per-customer limit, negative-total guard), Ledger chain verifier & reversal builder, Subscription lifecycle & proration policy, Dunning retry schedule, and Reconciliation engine.
3. **Repository & Modular API (`packages/db/lib/commerce-2-repository.mjs`, `apps/api/routes/commerce2.mjs`):**
   - `TenantTx`-scoped CRUD & operations mounted in `apps/api/routes/payments.mjs` under `/api/commerce/v2/*`.
4. **Unified Commerce 2.0 UI (`apps/web/src/components/CommerceHub2Panel.tsx`):**
   - Mounted in `apps/web/src/pages/Payments.tsx` with tabs for Commerce Overview, Products, Refunds, Coupons 2.0, Subscriptions 2.0, Ledger & Integrity, and Reconciliation.
5. **Testing & Documentation:**
   - `packages/platform-core/test/commerce-2-0.test.mjs`, full regression (`@operza/api`, `@operza/db`, `verify-ci-postgres.mjs`, `@operza/web` `typecheck` + `build`, `test-e2e.mjs`, `run-seo-checks.mjs`), and all 11 docs in `docs/PRODUCT_ADVANCEMENT/COMMERCE_2/`.
