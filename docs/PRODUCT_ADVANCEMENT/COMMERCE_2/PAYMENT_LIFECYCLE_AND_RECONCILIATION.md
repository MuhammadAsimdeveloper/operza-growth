# Commerce 2.0 — Payment Lifecycle & Reconciliation

- **Payment State Machine (`canTransitionPayment`):** `pending`, `requires_action`, `processing`, `succeeded`, `failed`, `cancelled`, `partially_refunded`, `refunded`. Transitioning to `succeeded` requires `viaProviderCallback: true`.
- **Idempotency:** `buildPaymentIdempotencyKey` derives deterministic SHA-256 keys; `commerce_webhook_events` enforces `UNIQUE (provider, provider_event_id)` for out-of-order/duplicate webhook protection; `commerce_refunds` enforces `UNIQUE (agency_id, location_id, idempotency_key)`.
- **Cumulative Refund Cap:** `validateRefundEligibility` & `commerce2Repo.requestRefund` lock the payment row `FOR UPDATE`, sum prior approved/submitted/succeeded refunds, reject requests exceeding remaining captured cents, and require explicit approval above `approvalThresholdCents` (`50000` cents).
- **Reconciliation:** `reconcileCommerceRecords` cross-checks paid invoices, succeeded payments, and ledger credit entries to surface discrepancies.
