# Subscription Entitlements & Usage

- Reuses `saas_subscriptions` (`039`), `/api/platform/plans`, `/api/platform/entitlements`, `/api/platform/usage`, and `PlanUsage.tsx` (`/plan-usage`) without creating a duplicate billing system or fabricating limits.
- `analytics2.mjs` local-state fallback explicitly sets `source: 'local_dev_in_memory'` and `authoritative: false` so non-PostgreSQL metrics are never mistaken for authoritative DB metrics.
