# Mobile & PWA 2.0 — Honest Offline Capabilities

- **Supported Offline:**
  - Cached static assets (`/assets/*`, manifest, icons).
  - Navigation fallback to `/offline.html` explaining that an active connection is required.
  - Live `OfflineBanner` in `AppShell.tsx` (`subscribeOnlineStatus`) alerting users when `navigator.onLine === false`.
- **Intentionally Unavailable Offline:**
  - CRM records, conversations, payments, refunds, invoices, and workflow executions are never cached in service-worker storage or replayed offline without explicit server-side idempotency.
- **Push Notifications:** Deferred (VAPID keys and web-push delivery infrastructure are not configured locally).
