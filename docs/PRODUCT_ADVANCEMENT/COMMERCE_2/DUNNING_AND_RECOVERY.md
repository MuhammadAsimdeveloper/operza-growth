# Commerce 2.0 — Dunning & Failed Payment Recovery

- **Bounded Retry Policy (`evaluateDunningSchedule`):** Configurable `maxAttempts` (default `4` retries at `24h`, `72h`, `120h`, `168h`). Permanent declines (`isPermanentDecline: true`) and exhausted attempts stop retries immediately and transition to `mark_past_due_or_cancel`.
- **Grace Period:** `isSubscriptionActive` honors `grace_period_ends_at` for `past_due` subscriptions before revoking entitlements.
- **Testing Guardrail:** All dunning tests run against fake adapters; no real failed-payment customer notifications or live retries are dispatched locally.
