# PWA Security Review — Stage 18

## 1. Service Worker (`apps/web/public/sw.js`)

- **Cache Versioning:** Uses `CACHE_PREFIX = 'operza-'` and `CACHE_VERSION = 'operza-static-v2'`.
- **API & WebSocket Bypass:** Explicitly returns early for `method !== 'GET'`, cross-origin requests, `/api/*`, and `/ws`. Authenticated API responses and tenant data are never cached.
- **Navigation Fallback:** Navigation requests fetch from network and only fall back to `/offline.html` on network failure, without caching private HTML responses.
- **Logout & Tenant-Switch Purge:** `OPERZA_PURGE_CACHE` message deletes all `operza-` prefixed caches while leaving unrelated origin caches untouched.
- **Honest Scope:** Only the static shell and allowlisted static assets (`/manifest.json`, `/favicon.svg`, `/icon-192.svg`, `/icon-512.svg`, `/offline.html`) are cached; full offline CRM mutation sync is not claimed.
