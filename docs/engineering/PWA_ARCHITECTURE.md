# Phase 7 — PWA Architecture & Cache Security

**Manifest:** `apps/web/public/manifest.json`
**Service Worker:** `apps/web/public/sw.js` (`CACHE_VERSION = 'operza-static-v1'`)
**Client Helper:** `apps/web/src/lib/pwa.ts`

- **Strict Cache Boundary:** `sw.js` caches only static assets (`/assets/*`, `/manifest.json`, `/favicon.svg`) and explicitly bypasses `/api/*` and `/ws`.
- **Session Purge:** `purgePwaTenantCaches()` sends `OPERZA_PURGE_CACHE` to the active Service Worker and clears `window.caches` on logout or agency switch.
