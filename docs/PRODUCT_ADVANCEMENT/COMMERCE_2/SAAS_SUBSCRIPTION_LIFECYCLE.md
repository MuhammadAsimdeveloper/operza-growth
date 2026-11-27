# Commerce 2.0 — SaaS Subscription Lifecycle & Entitlements

- **States (`canTransitionSubscription`):** `trialing`, `active`, `past_due`, `paused`, `cancelled`, `expired`.
- **Server-Side Enforcement:** `saas-subscriptions-repository.mjs` (`assertFeatureEntitled`, `assertSeatLimit`, `isSubscriptionActive`) resolves authoritative plan limits from `entitlements.mjs` without trusting client-supplied state.
- **Lifecycle Audit (`047_commerce_2_0.sql`):** Added `billing_interval`, `cancel_at_period_end`, `current_period_start`, `current_period_end`, `paused_at`, and `saas_subscription_events` (`FORCE RLS`) to audit every transition and plan change.
- **Proration (`calculateProration`):** Deterministic minor-unit proration helper; no estimated prorations are charged without verified provider calculation.
