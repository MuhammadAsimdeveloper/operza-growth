# Internal Penetration Test Report

**Scope:** Controlled, non-destructive internal assessment against local isolated API + PostgreSQL (`node:test` + `load-chaos-real.mjs`).
**Important Notice:** This is an **internal** engineering assessment, **not** an independent third-party penetration test.

| Finding ID | Severity | Scenario Tested | Result & Evidence |
| --- | --- | --- | --- |
| **PT-01** | High (Fixed) | Missing `CSP` & `HSTS` headers on JSON API responses | **Remediated:** Added `content-security-policy: default-src 'none'; frame-ancestors 'none'` and `strict-transport-security` to `sendJson()` in `apps/api/server.mjs`; retested (`phase8-security-certification.test.mjs`). |
| **PT-02** | High (Fixed) | PWA Service Worker cache not purged on `logout()` / `switchLocation()` | **Remediated:** Wired `purgePwaTenantCaches()` into `AuthContext.tsx` `logout()` and `switchLocation()`. |
| **PT-03** | Info (Passed) | Unauthenticated access to `/api/crm/contacts` & `/api/platform-admin/audit` | **Blocked (`401`):** Verified live in `load-chaos-real.mjs`. |
| **PT-04** | Info (Passed) | Agency owner attempting `/api/platform-admin/*` or `/api/admin/*` | **Blocked (`403`):** Verified in `phase7.mjs` and `durable-workflow-and-postgres.test.mjs`. |
| **PT-05** | Info (Passed) | OAuth auth code replay & refresh-token reuse | **Blocked (`AUTH_CODE_REPLAYED`, `REFRESH_TOKEN_REUSED`):** Verified in `real-postgres-integration.test.mjs`. |
| **PT-06** | Info (Passed) | Cross-tenant IDOR on RAG, Custom Domains, Sites, SaaS, Marketplace, GDPR | **Blocked (`0` rows under `operza_app` `FORCE RLS`):** Verified in `real-postgres-integration.test.mjs`. |
| **PT-07** | Info (Passed) | JSON-LD `<script>` breakout XSS in `ssr-renderer.mjs` | **Blocked (`\u003c` escaping):** Verified in `phase6-sites-domains-calendar.test.mjs`. |
