# Phase 1.7 Pre-Flight Audit & Domain Design
## Payments, Orders, Invoices & Financial Ledger Domain Extraction

**Repository:** `MuhammadAsimdeveloper/operza-growth`  
**Workspace:** `C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Verified Baseline HEAD:** `679a6634b94170317442d6e0dab0d4da8edb597b` (`679a663`)  
**Master-Plan Reference:** `docs/plans/02_MASTER_PLAN.md` §B Phase 1 (Items 2, 5, 6), `docs/plans/03_FEATURE_SPECS.md` §F6  
**Date:** 2026-11-25  

---

## 1. Verified Repository Baseline

- `git branch --show-current`: `feat/operza-agency-launch-readiness`
- `git rev-parse HEAD`: `679a6634b94170317442d6e0dab0d4da8edb597b`
- `git status -sb`: `## feat/operza-agency-launch-readiness...origin/feat/operza-agency-launch-readiness [ahead 4]` (clean working tree, not pushed)
- Phase 1.6 commit `679a663` verified in git log.

---

## 2. Financial Schema & Codebase Audit Findings

1. **Ledger Tables (`013_transactional_billing_ledger.sql`)**:
   - `billing_ledger_accounts` and `billing_ledger_entries` exist with `FORCE ROW LEVEL SECURITY` and integer `bigint balance_cents` / `amount_cents CHECK (amount_cents > 0)` and SHA-256 `checksum`.
   - **Critical gap discovered:** `operza_app` was NOT granted `SELECT/INSERT/UPDATE` on `billing_ledger_accounts` or `SELECT/INSERT` on `billing_ledger_entries` in Migrations 023/024, and `billing_ledger_entries` lacked an `idempotency_key` unique index and commerce `reference_type` values (`order_payment`, `invoice_payment`, `upsell_payment`).
2. **Orders, Invoices & Payments Storage**:
   - No dedicated SQL tables exist in Migrations 001–032 for `orders`, `invoices`, or `payments`; they previously fell back to `location_records` or `state.records`.
   - Dedicated tables with `bigint` minor units (`amount_cents`), ISO-4217 currency checks, state-transition constraints, idempotency unique indexes, `provider_event_id` uniqueness, and `FORCE ROW LEVEL SECURITY` are required in **Migration 033**.
3. **Funnel Dual-Truth Finding (`apps/api/routes/funnels.mjs`)**:
   - `POST /api/funnels/checkout/one-click-upsell` and `POST /api/funnels/optin/:slugOrId` still write `contacts`, `opportunities`, `orders`, `payments`, and `invoices` to `state.records` even when `pgPool` is configured.
   - Phase 1.7 will route all `pgPool` financial & CRM mutations in `funnels.mjs` through `TenantTx` repositories with zero writes to `state.records`.
4. **Simulated vs Live Gateway Boundary**:
   - Live Stripe Connect charging is Phase 3. Phase 1.7 preserves explicit `simulated` / `test` mode when `STRIPE_SECRET_KEY` is absent, keeps production fail-closed guards (`503 PAYMENTS_NOT_CONFIGURED` / `WEBHOOK_SECRET_REQUIRED`), and never claims live Stripe settlement without verified webhooks.

---

## 3. Phase 1.7 Deliverables

1. **`packages/db/migrations/033_commerce_and_ledger_hardening.sql`**:
   - Creates `orders`, `invoices`, `payments` tables with `bigint` minor-unit amounts, currency constraints, idempotency unique indexes, `provider_event_id` uniqueness, and `FORCE ROW LEVEL SECURITY`.
   - Hardens `billing_ledger_entries` with `idempotency_key` unique index and commerce reference types, and grants least-privilege `operza_app` permissions (`SELECT, INSERT` immutable on `billing_ledger_entries`).
2. **`packages/db/lib/money.mjs`**:
   - Decimal-safe integer minor-unit (`cents`) conversion & ISO-4217 currency validation without binary float drift.
3. **Four `TenantTx` Repositories**:
   - `packages/db/lib/orders-repository.mjs`
   - `packages/db/lib/payments-repository.mjs`
   - `packages/db/lib/invoices-repository.mjs`
   - `packages/db/lib/ledger-repository.mjs`
   - Exported from `packages/db/lib/database.mjs`.
4. **`apps/api/routes/payments.mjs`**:
   - Encapsulates public payment links, public checkout, portal invoice payment, Stripe webhook financial handling, CRM orders/invoices/payments CRUD, refunds, and ledger endpoints.
5. **Funnel Dual-Truth Repair (`apps/api/routes/funnels.mjs`)**:
   - Eliminates `state.records` financial/CRM writes when `pgPool` is configured.
6. **TDD + Real PostgreSQL Verification**:
   - Repository unit tests, API contract tests, real PostgreSQL concurrency/idempotency/RLS/rollback tests, and full regression (`verify-ci-postgres.mjs`, `test-e2e.mjs`, `typecheck`, `build`, `seo`).
