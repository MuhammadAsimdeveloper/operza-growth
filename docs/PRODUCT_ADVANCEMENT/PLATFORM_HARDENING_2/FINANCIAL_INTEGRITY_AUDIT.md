# Financial Integrity Audit — Stage 18

## 1. Minor-Unit & Ledger Guarantees (`commerce-2-repository.mjs`, `commerce-2-0.mjs`, `ledger-repository.mjs`)

- **Integer Minor Units:** All prices, invoices, payments, and refunds use integer cents (`priceCents`, `amountCents`) and `assertValidCurrency`.
- **Refund Protection:** `requestRefund` locks the payment row (`SELECT ... FOR UPDATE`), sums existing `approved|submitted|succeeded` refunds, and calls `validateRefundEligibility` to reject over-refunds (`REFUND_EXCEEDS_CAPTURED_AMOUNT`) and enforce approval rules (`REFUND_APPROVAL_REQUIRED`).
- **Idempotency & Hash Chain:** Deduplicates by `(agency_id, location_id, idempotency_key)`, records double-entry ledger transactions (`ledger_${key}`), and verifies cryptographic hash-chain integrity (`verifyLedgerIntegrity`).
- **Revenue Aggregation:** `aggregateCanonicalRevenueByCurrency` separates currencies and excludes failed/pending invoices from paid revenue.

## 2. Stage 18 Authorization Fix

- `apps/api/routes/commerce2.mjs` now enforces `orders:read`, `billing:read`, `invoices:write`, `refunds:approve`, and `agency:billing:manage` via `checkActorPermission`.
- **Compliance Note:** Internal application tests do **not** constitute PCI DSS certification.
