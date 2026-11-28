# Stage 18 Testing & Verification Evidence

All commands below were executed sequentially against the final Stage 18 working tree (before local commit) on Windows, Node.js v24.22.0, with isolated PostgreSQL (`IsolatedTestPostgres`) and Playwright headless Chromium (`chromium-1248`).

## 1. Focused Stage 18 & Hardening Verification

| Check | Command | Outcome | Key Metrics / Evidence |
| --- | --- | --- | --- |
| Stage 18 Focused Suite | `node --test packages/platform-core/test/stage-18-hardening.test.mjs` | **PASS (2/2)** | Enforces all 12 built-in roles on cookie-session actors; verifies 100% FORCE RLS across all 126 `agency_id` tables; measures local `TenantTx getExecutiveOverview` (100 contacts, 20 runs): `p50=17.44ms`, `p95=23.62ms`. |
| Migration 053 & RLS Audit | `node rls_audit.mjs` (fresh `001`–`053` + upgrade `001`–`052` → `053`) | **PASS (0 defects)** | Inspected **134** public tables: **126** tenant-owned (`agency_id`) tables all have `rls_enabled=true`, `force_rls=true`, and `>=1` policy; **8** non-tenant tables; **134/134** runtime grants for `operza_app` and `operza_worker` (`rolbypassrls=false`, `rolsuper=false`). Cross-tenant isolation verified across 2 agencies. |
| Dependency Audit (Prod) | `npm audit --omit=dev --json` | **PASS (0 vulns)** | `info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0`. |
| Dependency Audit (All) | `npm audit --json` | **10 dev-only vulns** | 1 high (`zod <4.6.6` dev/transitive), 9 moderate (`eslint`, `@typescript-eslint/*`, `@eslint/config-array`, `minimatch`). Zero production runtime impact. |
| Playwright Browser Audit | `node stage18_playwright.mjs` | **PASS (96/96 checks)** | Tested 16 routes × 6 viewports (`1920x1080`, `1440x900`, `1366x768`, `768x1024`, `390x844`, `360x800`). `overflowCount=0`, `pageErrorsCount=0`, `unauthRedirected=true`, `badgeVisible=true` (`Local Dev Fallback (Non-Authoritative)`). |

## 2. Full Regression Suite Results

| Suite | Command | Pass | Fail | Skip | Notes |
| --- | --- | --- | --- | --- | --- |
| Platform Core | `npm --workspace=@operza/platform-core test` | 218 | 0 | 1 | 1 pre-existing skip: Live Provider Sandbox Network Gate (`LIVE_PROVIDER_TESTS=true` not set). |
| API Server | `npm --workspace=@operza/api test` | 189 | 0 | 0 | Sequential `--test-concurrency=1`, includes real PostgreSQL auth, RLS, booking, workflow recovery. |
| Workflow Engine | `npm --workspace=@operza/workflow-engine test` | 86 | 0 | 0 | Includes 1,000-job chaos/scale test (zero lost jobs, zero duplicate side effects). |
| Action Governance | `npm --workspace=@operza/action-governance test` | 6 | 0 | 0 | ReDoS, prototype pollution, credential defense, schema, AST. |
| UI Primitives | `node --test packages/ui/test/ui.test.mjs` | 1 | 0 | 0 | Design System 2.0 exports. |
| System E2E | `node scripts/test-e2e.mjs` | 116 | 0 | 0 | Includes updated TEST 66 verifying `/metrics` does not leak `totalUsers` unauthenticated. |
| Web TypeScript | `npm --workspace=@operza/web run typecheck` | PASS | — | — | `tsc -b --noEmit` exited 0. |
| Web Production Build | `npm --workspace=@operza/web run build` | PASS | — | — | 272 modules transformed, 12 public routes prerendered. |
| Marketing Build | `npm --workspace=apps/marketing run build` | PASS | — | — | Astro static build exited 0. |
| SEO Audit | `node scripts/seo-audit/run-seo-checks.mjs` | 106 | 0 | 0 | 100% compliance across metadata, canonicals, JSON-LD, competitor filter. |

## 3. E2E Test 66 Diff Review

`scripts/test-e2e.mjs` lines 2387–2388 were updated so unauthenticated `GET /metrics` is verified to return `memory.rssMb` (number) and `database.engine` while **not** exposing `database.totalUsers` (`=== undefined`). This protects the Stage 18 `/metrics` tenant-data hardening without weakening observability telemetry checks.
