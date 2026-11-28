# API Security Review — Stage 18

## 1. Boundary Controls Verified

- **CORS (`server.mjs` `getCorsOrigin`):** Allowlists configured origins (`ALLOWED_ORIGINS_LIST`) and permits `localhost`/`127.0.0.1` only when `NODE_ENV !== 'production'`.
- **CSRF (`server.mjs` `validateCsrf`):** Enforced on all mutating methods (`POST`, `PUT`, `DELETE`) for cookie-authenticated sessions using `x-operza-csrf` compared against `actor.csrfHash` via `safeEqual`.
- **Security Headers (`sendJson`):** Sets `content-security-policy: default-src 'none'; frame-ancestors 'none'`, `strict-transport-security: max-age=31536000; includeSubDomains`, `x-content-type-options: nosniff`, `cache-control: no-store`, and `x-request-id`.
- **Request Size Limits:** `readBody` and `readRawBody` enforce a `5 MB` payload cap (`Body too large`).
- **SSRF & Webhooks:** `isSafeWebhookUrl` rejects non-HTTPS/private-IP targets (`localhost`, RFC1918, link-local), and `verifyWebhookSignature` validates HMAC-SHA256 webhook signatures.
- **Error Serialization & Information Disclosure:** `/metrics` now gates tenant entity counts behind `OPERZA_ADMIN_KEY` or `isPlatformAdmin`.

## 2. Confirmed Fixes Applied

- Consolidated cookie-session and API-key authorization onto `checkActorPermission` (`route-authz.mjs`) across v1 and v2 routers.
- Fixed `crm2.mjs` `parseAndValidateCsvImport` positional-argument mismatch.
- Normalized `isPlatformAdminActor` across `marketplace2.mjs` and `phase7.mjs`.
