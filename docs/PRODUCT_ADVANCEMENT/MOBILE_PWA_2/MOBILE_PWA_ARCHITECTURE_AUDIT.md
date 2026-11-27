# Operza Growth — Mobile Experience & Progressive Web App 2.0 Architecture Audit

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `d5d8570`

---

## 1. Existing PWA & Responsive Audit

### 1.1 `manifest.json` & Assets (`apps/web/public/`)
- **Existing:** `name`, `short_name`, `description`, `start_url: "/"`, `display: "standalone"`, `background_color: "#ffffff"`, `theme_color: "#4f46e5"`, and single `favicon.svg` icon.
- **Gaps:** Missing `id`, `scope`, and `192x192` / `512x512` icon entries (`any` and `maskable`) for Chromium/Android installability.

### 1.2 Service Worker (`apps/web/public/sw.js`) & `pwa.ts`
- **Strengths:** Never caches `/api/*` or `/ws`; only caches `GET` requests for `/assets/*` and `STATIC_ALLOWLIST`; purges caches on `OPERZA_PURGE_CACHE` triggered by `AuthContext.tsx` (`logout()` and `switchLocation()`).
- **Gaps:**
  - Lacks an explicit `offline.html` navigation fallback when the network is unreachable.
  - Lacks explicit `url.origin !== self.location.origin` guard and `operza-` cache-prefix scoping during purge (to avoid touching unrelated origin caches).
  - No `OfflineBanner` in `AppShell.tsx` to honestly communicate offline status and unavailable network features.

### 1.3 Mobile Shell & Responsive Design (`AppShell.tsx`, `tokens.css`, `app.css`)
- **Strengths:** Stage 8 verified `overflowX: false` across `1440x900` and `390x844` and fixed mobile Copilot FAB overlap.
- **Gaps:** Missing `env(safe-area-inset-*)` padding for notched devices, `Escape` key closing for the mobile nav drawer, and `44px` touch-target / scrollable-tab polish on narrow screens.

### 1.4 Push Notifications
- **Status:** VAPID keys and web-push delivery infrastructure are not configured locally; Web Push remains **deferred**.
