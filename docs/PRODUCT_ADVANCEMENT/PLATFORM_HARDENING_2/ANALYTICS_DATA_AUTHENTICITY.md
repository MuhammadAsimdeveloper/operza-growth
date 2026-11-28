# Analytics Data Authenticity — Stage 18

## 1. Authoritative vs Non-Authoritative Contract

- **PostgreSQL Path (`packages/db/lib/analytics-2-repository.mjs`):** `getExecutiveOverview` now explicitly returns `source: 'postgresql'`, `authoritative: true`, and `freshness: 'real_time_source_query'`.
- **In-Memory Fallback (`apps/api/routes/analytics2.mjs`):** When `!pgPool`, `/api/reports/v2/overview` explicitly returns `source: 'local_dev_in_memory'`, `authoritative: false`, and `warning`.
- **UI Visibility (`apps/web/src/components/BiStudio2Panel.tsx`):** Displays a `PostgreSQL Authoritative` (green) or `Local Dev Fallback (Non-Authoritative)` (amber) badge plus a visible `role="status"` warning banner whenever `authoritative === false`.
- **Permission Hardening:** `analytics2.mjs` no longer falls back to `['*']` when `actor.scopes` is absent; it uses `resolveActorPermissions(actor)` and enforces `reports:read`.
