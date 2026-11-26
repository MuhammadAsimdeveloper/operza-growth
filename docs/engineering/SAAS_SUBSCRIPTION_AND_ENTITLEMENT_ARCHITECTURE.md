# Phase 7 — SaaS Subscription & Entitlement Architecture

**Migration:** `packages/db/migrations/039_phase7_saas_marketplace_oauth_admin.sql` (`saas_subscriptions`)
**Repository:** `packages/db/lib/saas-subscriptions-repository.mjs`
**Entitlements:** `packages/platform-core/src/entitlements.mjs`

- **Lifecycle:** `trialing`, `active`, `past_due` (within `grace_period_ends_at`), `paused`, `cancelled`, `expired`.
- **Server-Side Enforcement:** `assertFeatureEntitled()` and `assertWithinSeatLimit()` resolve plan capabilities strictly from PostgreSQL `saas_subscriptions` under `TenantTx` + `FORCE RLS`. Client-supplied plan IDs or entitlements are never trusted.
