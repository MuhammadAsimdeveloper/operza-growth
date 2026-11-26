# Phase 7 — Public API & OAuth 2.0 Application Platform

**Repository:** `packages/db/lib/oauth-repository.mjs`
**Routes:** `apps/api/routes/phase7.mjs` (`/api/oauth/*`), `apps/api/zapier-router.mjs` (`/api/v1/zapier/*`)

- **Confidential Client Security:** `createApp()` stores only SHA-256 `client_secret_hash` and `client_secret_prefix`, returning the plaintext secret once at creation.
- **Authorization Code + PKCE:** `issueAuthorizationCode()` enforces exact `redirect_uri` matching, scope subset validation, and PKCE S256 challenge storage.
- **Single-Use & Refresh Rotation:** `exchangeAuthorizationCode()` blocks code replay (`AUTH_CODE_REPLAYED`); `rotateRefreshToken()` revokes the entire token family for the app+user if a rotated/revoked refresh token is reused (`REFRESH_TOKEN_REUSED`).
