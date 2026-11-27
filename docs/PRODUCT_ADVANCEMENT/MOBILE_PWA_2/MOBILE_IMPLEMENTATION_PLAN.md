# Operza Growth — Mobile & PWA 2.0 Implementation Plan

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `d5d8570`

1. **Manifest, Icons & Offline Shell (`apps/web/public/`):**
   - Upgrade `manifest.json` with `id`, `scope`, `192x192` and `512x512` icons (`icon-192.svg`, `icon-512.svg` derived from `favicon.svg`), and `maskable` purpose.
   - Add `apps/web/public/offline.html` for honest offline navigation fallback.
   - Upgrade `apps/web/public/sw.js` (`operza-static-v2`): strict same-origin check, never cache `/api/*`, `/ws`, or authenticated responses, offline navigation fallback to `/offline.html`, and `operza-`-scoped cache purge.
   - Update `apps/web/src/lib/pwa.ts` with `operza-`-scoped purge and `useOnlineStatus` / `subscribeOnlineStatus` helper.
2. **Mobile Design System & Shell UX (`tokens.css`, `app.css`, `AppShell.tsx`):**
   - Add safe-area inset tokens (`--safe-top`, `--safe-bottom`), `44px` touch target sizing on mobile (`<=768px`), scrollable tab strips, `Escape` key handler + body scroll lock for mobile drawer, and an honest `OfflineBanner` when `navigator.onLine === false`.
3. **Security & PWA Unit Tests (`packages/platform-core/test/pwa-cache-security.test.mjs`):**
   - Verify `sw.js` never caches `/api/*` or `/ws`, checks same-origin, purges `operza-*` caches cleanly, and `manifest.json` declares valid existing icons.
4. **Multi-Viewport Playwright Verification:**
   - Capture and inspect screenshots at `1920x1080`, `1440x900`, `1366x768`, `768x1024`, `390x844`, and `360x800` across critical routes, checking `0` pageErrors and `overflowX: false`.
5. **Documentation & Full Regression:**
   - Complete all 10 docs in `docs/PRODUCT_ADVANCEMENT/MOBILE_PWA_2/` and run full repository verification.
