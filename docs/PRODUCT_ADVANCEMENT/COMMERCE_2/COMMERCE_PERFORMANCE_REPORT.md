# Commerce 2.0 — Performance & Resource Report

- **Indexed Lookups (`047_commerce_2_0.sql`):** Dedicated indexes on `commerce_refunds (agency_id, location_id, payment_id)` and `commerce_coupon_redemptions (agency_id, location_id, coupon_id, contact_id)` plus `UNIQUE` idempotency constraints.
- **Lock Contention:** `FOR UPDATE` locks are scoped tightly to individual payment or subscription rows inside `TenantTx` transactions.
- **Frontend:** `CommerceHub2Panel.tsx` is lazy-loaded inside `Payments.tsx` via `React.lazy` route splitting.
