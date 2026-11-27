# Mobile & PWA 2.0 — Service Worker & Cache Security

- **`apps/web/public/sw.js` (`operza-static-v2`):**
  - Strictly same-origin (`url.origin !== self.location.origin` ignored).
  - Never caches `POST`/mutating requests, `/api/*`, `/ws`, or authenticated HTML pages.
  - Caches only `/assets/*` and `STATIC_ALLOWLIST` (`/manifest.json`, `/favicon.svg`, `/icon-192.svg`, `/icon-512.svg`, `/offline.html`).
  - `OPERZA_PURGE_CACHE` and `activate` cleanup delete only `operza-`-prefixed caches so unrelated origin data is preserved.
- **`AuthContext.tsx`:** Calls `purgePwaTenantCaches()` and `queryClient.clear()` on both `logout()` and `switchLocation()`.
