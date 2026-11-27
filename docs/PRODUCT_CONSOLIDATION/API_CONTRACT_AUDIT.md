# Stage 8 — API & Contract Consistency Audit

**Date:** 2026-11-27  
**Baseline Commit:** `044f203`

---

## 1. Surface Overview
- **Backend:** Native `node:http` router in `apps/api/server.mjs` delegating to 25 modular route handlers in `apps/api/routes/*.mjs`.
- **Frontend Client:** Typed `request<T>()` and namespaced `api` object in `apps/web/src/lib/api.ts` (repaired in Stage 7 across Stage 2–6 panels).
- **Security Controls:** HttpOnly session cookies, `x-csrf-token` / `x-operza-csrf` enforcement on mutating cookie-auth requests, `op_live_...` API key scope enforcement (`checkScope`), and `rateLimit` on auth/OTP/OAuth.

## 2. Contract Consistency Findings

1. **API-DEF-001 (High) — Legacy `/api/crm/workflows` `!pgPool` Field Drop:**
   - `apps/api/routes/workflows.mjs` (lines 1228–1241) ignores `body.actions` and `body.trigger` when `pgPool` is null, persisting only `nodes` and `triggerConfig`.
   - Causes `release-verification-gaps.test.mjs` Tests 3 & 4 to fail (`created.actions` is `undefined`, `GET /api/crm/workflows/` returns `404`).
2. **API-DEF-002 (Medium) — `/api/platform/plans` vs `PlanUsage.tsx` Contract Mismatch:**
   - `PlanUsage.tsx` expects `p.limits.workflowRunsPerMonth` and `p.limits.copilotRequestsPerMonth` to always be numbers, calling `.toLocaleString()` without nullish fallback, which crashes `/plan-usage` when a plan tier omits or renames those keys.
3. **API-INFO-001 — Dual Route Aliases (`/api/crm/workflows` & `/api/workflows`, `/api/crm/v2/*`, `/api/workflows/v2/*`):**
   - Maintained intentionally for backward compatibility with E2E tests and older clients; `workflows2.mjs`, `crm2.mjs`, `integrations2.mjs`, `ai2.mjs`, `marketplace2.mjs`, and `analytics2.mjs` are cleanly mounted inside their respective domain routers.
4. **API-INFO-002 — Honest `503` Fail-Closed Behavior in `!pgPool` Mode:**
   - V2 PostgreSQL-only endpoints (`/api/crm/v2/smart-lists`, `/api/marketplace/installations`, `/api/reports/v2/overview`) return `503 Service Unavailable` when PostgreSQL is unconfigured rather than returning fake empty data.
5. **API-INFO-003 — Secret Stripping:**
   - `integrations2.mjs` strips `vault_secret_ref`, `workflows2.mjs` redacts sensitive step payloads, and `analytics2.mjs` redacts PII on exports.
