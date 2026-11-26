# OWASP ASVS v4.0.3 Level 2 Security Verification

**Standard Pinned:** OWASP Application Security Verification Standard (ASVS) **v4.0.3 — Level 2**
**Assessment Date:** 2026-11-26
**Target:** Operza Growth Monorepo (`apps/api`, `apps/web`, `apps/marketing`, `packages/*`)

| Req ID | Requirement Summary | Status | Evidence & Remediation |
| --- | --- | --- | --- |
| **V2.1.1** | Password/credential hashing & verification | **PASS** | `scrypt` per-user salted hashes in `apps/api/routes/auth.mjs`; `timingSafeEqual` in OAuth/HMAC checks. |
| **V2.2.1** | Anti-automation / rate limiting on auth & API | **PASS** | Layered IP + identifier rate limiter (`auth-rate-limiter.mjs`) wired into `/api/auth/login`, `/api/oauth/authorize`, `/api/oauth/token` with trusted-proxy `X-Forwarded-For` validation & `Retry-After` (`phase8-1-remediation.test.mjs`). |
| **V3.2.1 / V3.3.1** | Session generation, expiration & logout invalidation | **PASS** | Server-side PostgreSQL sessions; `AuthContext.tsx` now calls `purgePwaTenantCaches()` on `logout()` & `switchLocation()`. |
| **V4.1.1 / V4.2.1** | Multi-tenant access control & IDOR prevention | **PASS** | `TenantTx` + PostgreSQL `FORCE ROW LEVEL SECURITY` (`operza_app`) verified across all 39 migrations (`130/130` real PG tests). |
| **V4.3.1** | Administrative privilege separation | **PASS** | `/api/admin/*` (`system.mjs`) & `/api/platform-admin/*` (`phase7.mjs`) return `403` for agency owners/admins. |
| **V5.2.1 / V5.3.3 / V5.3.4** | Injection (SQLi, XSS, JSON-LD) prevention | **PASS** | Parameterized SQL throughout; `ssr-renderer.mjs` escapes HTML & `<` (`\u003c`) inside JSON-LD `<script>`. |
| **V6.2.1 / V8.3.4** | Secret/token hashing & encryption at rest | **PASS** | OAuth secrets/tokens SHA-256 hashed (`oauth-repository.mjs`); provider secrets encrypted via `secret-vault-repository.mjs`. |
| **V7.1.1** | No secrets/PII in logs or error responses | **PASS** | `sanitizeProviderError()` redacts keys; `gdpr-repository.mjs` logs export IDs without PII. |
| **V10.3.2** | OAuth PKCE, single-use codes & refresh rotation | **PASS** | Verified in `real-postgres-integration.test.mjs` (`AUTH_CODE_REPLAYED`, `REFRESH_TOKEN_REUSED`). |
| **V12.1.1** | File upload size & type restrictions | **PARTIAL** | `upload-scanner.mjs` enforces magic-byte signatures, MIME/size caps, private quarantine, and fail-closed `MALWARE_SCANNER_UNAVAILABLE` policy; live ClamAV daemon required in staging. |
| **V14.4.1** | HTTP security headers (`CSP`, `HSTS`, `nosniff`, `X-Frame-Options`) | **PASS** | Added `Content-Security-Policy` & `Strict-Transport-Security` to `sendJson()` in `apps/api/server.mjs` (retested via `phase8-security-certification.test.mjs`). |
