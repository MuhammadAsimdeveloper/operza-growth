# Stage 19 Testing & Verification Evidence

## 1. Stage 19 Focused Verification (`stage19_rc1_verify.mjs`)

- **Live API Business Journeys:** Exercised J1–J9 against `apps/api/server.mjs` with `x-operza-csrf` + cookie sessions:
  - J1 (Agency Onboarding), J5 (Workflow Automation), J9 (AI Assistance) **PASS**.
  - J2 (`customer_360` `503`) & J7 (`portal_settings` `503`) confirmed honest fail-closed behavior when PostgreSQL is absent.
- **RBAC & Hardening Revalidation:**
  - Unauthenticated `GET /api/reports/v2/overview` -> `401`.
  - Unauthenticated `GET /metrics` -> `database.totalUsers === undefined`.
  - 8 built-in roles (`owner`, `admin`, `location_manager`, `sales_agent`, `support_agent`, `marketing_specialist`, `analyst`, `read_only`) verified via `route-authz.mjs`.
- **PostgreSQL RLS Isolation (`IsolatedTestPostgres`):** `operza_app` cross-tenant contacts leak = `0`; `operza_worker` cross-tenant locations leak = `0`.
- **Local Performance Benchmarks (100 contacts, 2 agencies, warm-up + 20 runs):**
  - CRM Contacts List: `p50=1.05ms`, `p95=1.74ms`, `p99=1.74ms`
  - Analytics Executive Overview: `p50=4.29ms`, `p95=5.81ms`, `p99=5.81ms`
  - Team & Locations List: `p50=0.56ms`, `p95=0.80ms`, `p99=0.80ms`
  - Workflow Execution History: `p50=0.73ms`, `p95=1.47ms`, `p99=1.47ms`

## 2. Regression, Build, Accessibility & Browser Verification

- `@operza/action-governance`: **6/6 pass** (Stage 19 re-run)
- `@operza/workflow-engine`: **86/86 pass** (Stage 19 re-run)
- `packages/ui/test/ui.test.mjs`: **1/1 pass** (Stage 19 re-run)
- `@operza/web` `tsc -b --noEmit`: **PASS** (Stage 19 re-run)
- `scripts/seo-audit/run-seo-checks.mjs`: **106/106 pass** (Stage 19 re-run)
- `@operza/platform-core`: **218 pass, 0 fail, 1 skip** (verified at baseline `ec896b9`)
- `@operza/api`: **189 pass, 0 fail, 0 skip** (verified at baseline `ec896b9`)
- `scripts/test-e2e.mjs`: **116/116 pass** (verified at baseline `ec896b9`)
- `@operza/web` build (`272` modules, `12` prerendered routes) & `apps/marketing` build: **PASS** (verified at baseline `ec896b9`)
- Playwright (`stage18_playwright.mjs`): **96/96 checks pass** (16 routes × 6 viewports, `0` overflows, `0` page errors)
- Accessibility scan (`apps/web/src/`): `232` `aria-*` attributes, `29` `role=` attributes, `3` `prefers-reduced-motion` rules.
- `npm audit --omit=dev --json`: **0 production vulnerabilities** (`10` dev-only advisories).
