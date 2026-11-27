# Commerce 2.0 — Unified Domain Model

- **Commerce:** Products (`commerce_products`), Orders (`orders`), Coupons (`coupons`, `commerce_coupon_redemptions`), Customer Associations.
- **Payments:** Payment Intents/Links (`payments`, `payment_links`), Refunds (`commerce_refunds`), Webhook Events (`commerce_webhook_events`).
- **Billing:** Invoices (`invoices`), Dunning (`dunning`), Reminders.
- **Financial Accounting:** Immutable Hash-Chained Ledger (`billing_ledger_accounts`, `billing_ledger_entries`), Reversals, Cross-Entity Reconciliation.
- **SaaS Subscriptions (Operza Platform Billing):** Plans (`entitlements.mjs`), Agency Subscriptions (`saas_subscriptions`), Lifecycle Audit (`saas_subscription_events`).

Customer-facing agency commerce is strictly separated from Operza's own SaaS subscription billing at the domain, authorization, and reporting layers.
