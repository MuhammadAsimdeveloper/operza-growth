# External Penetration Test Handoff (Phase 8.1)

**Status:** **NOT YET EXECUTED** — Prepared for independent third-party security assessment against isolated staging.

## 1. Architecture & Permitted Staging Targets
- **API:** `apps/api/server.mjs` (`node:http`, PostgreSQL 18 `FORCE RLS` + `operza_app`, Redis queue when provisioned).
- **Web & Marketing:** `apps/web` (React + Vite + PWA Service Worker), `apps/marketing` (Astro static site).

## 2. Role Matrix & Isolation Scenarios
- **Platform Admin (`isPlatformAdmin: true`)** vs **Agency Owner / Admin / Member / Viewer**.
- Verify `403` on `/api/admin/*` and `/api/platform-admin/*` for non-platform-admins.
- Verify `0` cross-tenant rows across `contacts`, `opportunities`, `appointments`, `payments`, `ai_knowledge_sources`, `custom_domains`, `saas_subscriptions`, `oauth_apps`, `gdpr`.

## 3. OAuth, Uploads, Rate Limiting & Webhooks
- Test OAuth 2.0 PKCE, `AUTH_CODE_REPLAYED`, `REFRESH_TOKEN_REUSED`, and redirect URI exact matching.
- Test `/api/auth/login` and `/api/oauth/*` rate limits (`429` + `Retry-After`) and spoofed `X-Forwarded-For` headers.
- Test upload magic-byte signature validation and quarantine isolation (`MALWARE_SCANNER_UNAVAILABLE` / `MALWARE_DETECTED`).
- Test Stripe/Twilio/Zapier webhook HMAC signature validation without targeting live external provider endpoints.
