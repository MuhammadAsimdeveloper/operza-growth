# Commerce 2.0 — Security & Compliance Review

- **Tenant & Location Isolation:** `commerce_products`, `commerce_refunds`, `commerce_coupon_redemptions`, and `saas_subscription_events` enforce composite `(agency_id, location_id, id)` primary keys, `FORCE ROW LEVEL SECURITY`, and `operza_app` / `operza_worker` grants.
- **Financial Controls:** No raw card storage in Operza; Stripe Connect/PaymentIntent operations remain disabled locally without live keys; refunds lock payment rows `FOR UPDATE`, enforce cumulative capture limits, and require approval above threshold.
- **Compliance Scope:** PCI DSS and regional tax/accounting compliance require qualified external review and live Stripe-hosted flows in production; sandbox verification does not constitute PCI DSS certification.
