# Marketplace Monetization Design

## 1. Integer Minor-Unit Pricing Metadata
`marketplace_apps` stores `pricing_model`, integer `price_cents >= 0`, and `currency` (no floating-point money).

## 2. Honest Release Gate Status
- **Implemented:** Pricing metadata validation, SaaS subscription/entitlement checks (`saas_subscriptions`), and Stripe Connect sandbox invoice/payment-link primitives.
- **Deferred (Release Gate):** Automated third-party publisher payouts, tax/VAT calculation, and live marketplace split-billing remain gated until legal/accounting compliance and live Stripe Connect onboarding are approved.
