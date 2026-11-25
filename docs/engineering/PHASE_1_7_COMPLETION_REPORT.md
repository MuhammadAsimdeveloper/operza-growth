# Phase 1.7 Completion Report & Milestone Certification
## Payments, Orders, Invoices & Financial Ledger Domain Extraction

**Repository:** `MuhammadAsimdeveloper/operza-growth`  
**Workspace:** `C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `679a663` (`refactor(pipelines,funnels): modularize pipelines and funnels domains with TenantTx repositories`)  
**Certification Status:** **COMPLETE & VERIFIED**  
**Date:** 2026-11-25  

---

## 1. Executive Summary

Phase 1.7 extracted the **Orders, Payments, Invoices, and Financial Ledger** domains into `TenantTx`-scoped PostgreSQL repositories and a modular HTTP router, added Migration 033, and eliminated financial dual-truth writes in `apps/api/routes/funnels.mjs`.

1. **Migration `033_commerce_and_ledger_hardening.sql`**:
   - Created `orders`, `invoices`, and `payments` tables with `bigint` minor-unit amounts (`amount_cents`), ISO-4217 currency checks, state constraints, partial unique idempotency indexes, `provider_event_id` uniqueness, and `FORCE ROW LEVEL SECURITY`.
   - Hardened `billing_ledger_entries` (Migration 013) with `idempotency_key` unique index and commerce reference types (`order_payment`, `invoice_payment`, `upsell_payment`), and granted least-privilege `operza_app` permissions (`SELECT, INSERT` immutable on `billing_ledger_entries`).
2. **Repositories & Decimal-Safe Money (`packages/db/lib/`)**:
   - `money.mjs`: `toCents`, `fromCents`, `validateCurrency` (no binary float drift).
   - `orders-repository.mjs`, `payments-repository.mjs`, `invoices-repository.mjs`, `ledger-repository.mjs` — all executing strictly through `TenantTx`.
3. **Router & Funnel Dual-Truth Repair**:
   - `apps/api/routes/payments.mjs`: handles public payment links/checkout, portal invoice pay, Stripe webhook reconciliation, CRM orders/invoices/payments CRUD, refunds, and ledger inspection/verification.
   - `apps/api/routes/funnels.mjs`: repaired `POST /api/funnels/checkout/one-click-upsell` and `POST /api/funnels/optin/:slugOrId` so `pgPool` paths execute atomically via `TenantTx` with zero writes to `state.records`.

---

## 2. Simulated vs Live Gateway Boundary (Honest Certification)
- When `STRIPE_SECRET_KEY` is absent, checkout and upsell operate in explicit `simulated` mode (`provider = 'simulated'`), while production boot/checkout fail-closed guards (`503 PAYMENTS_NOT_CONFIGURED` / `WEBHOOK_SECRET_REQUIRED`) remain enforced.
- Live Stripe Connect charging, real SMS/email settlement, and PDF invoice rendering remain scoped to **Phase 3 (Real Channels & Real Money)**.

---

## 3. Verification Evidence Matrix

| Check | Command | Exit Code | Result |
|---|---|:---:|---|
| Syntax Check | `node --check apps/api/server.mjs` | `0` | Passed |
| Domain Unit Tests | `node --test packages/db/test/... apps/api/test/...` | `0` | **35/35 passed** |
| Real PostgreSQL CI & RLS | `node scripts/verify-ci-postgres.mjs` | `0` | **130/130 passed** (Migration 033 applied + real PG commerce/ledger RLS) |
| System E2E Suite | `node scripts/test-e2e.mjs` | `0` | **116/116 passed** |
| Frontend Typecheck | `npm --workspace=@operza/web run typecheck` | `0` | Passed |
| Frontend Production Build | `npm --workspace=@operza/web run build` | `0` | Passed (12 routes prerendered) |
| SEO & Metadata Audit | `node scripts/seo-audit/run-seo-checks.mjs` | `0` | **106/106 passed** |
| Git Whitespace Check | `git diff --check` | `0` | Passed (0 errors) |
