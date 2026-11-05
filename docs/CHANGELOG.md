# Operza Changelog

All notable changes to the Operza platform are documented in this file.

## [2.1.0] - 2026-11-05
### Security & Ingress
- **Fixed (P0):** Rewrote public checkout handler (`/api/payments/checkout/:slug`) to initialize orders in `pending` status instead of marking them `paid` upon form submission.
- **Fixed (P0):** Removed hardcoded backdoor verification challenge (`meta_chall_44`) from Meta Messenger webhook. Enforced proper verify token and HMAC signature checks.
- **Fixed (P0):** Synchronized CSRF token flow: `/api/auth/session`, `/api/auth/signup`, and `/api/auth/login` now return `csrfToken`. Added `/api/auth/csrf` refresh endpoint.
- **Added:** Automatic CSRF in-memory caching and request injection in `@operza/web` API client (`apps/web/src/lib/api.ts`).
- **Added:** Automated regression test suite (`scripts/test-security-and-payments.mjs`) containing 21 tests for CSRF, webhooks, and payment state integrity.

### Engineering & Tooling
- **Added:** Google Colab research and evaluation notebooks (`research/colab/`).
- **Fixed:** CSS minification warning in `apps/web/src/styles/app.css` (`justifyContent` -> `justify-content`).
- **Documentation:** Added `docs/audit/BRUTAL_AUDIT.md`, `RISK_REGISTER.md`, `FEATURE_REALITY_MATRIX.md`, `ARCHITECTURE_BASELINE.md`, and `docs/design/FIGMA_IMPLEMENTATION_MAP.md`.
