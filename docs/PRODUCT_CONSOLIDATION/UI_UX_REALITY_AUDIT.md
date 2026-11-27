# Stage 8 — UI/UX Reality Audit

**Date:** 2026-11-27  
**Baseline Commit:** `044f203`  
**Method:** Live Playwright Chromium (`1.65.1` / `chromium_headless_shell-1248`) against `apps/api/server.mjs` (`127.0.0.1:4000`) and Vite (`127.0.0.1:5173`) with a synthetic authenticated agency session (`stage8_audit_*@operza.io`), desktop (`1440x900`) and mobile (`390x844`) viewports, and screenshot inspection.

---

## 1. Screen Verification Matrix

| Screen | Route | Desktop (`1440x900`) | Mobile (`390x844`) | Findings |
|---|---|---|---|---|
| Dashboard | `/dashboard` | Rendered (`2242` chars, `overflowX: false`) | Rendered (`overflowX: false`) | Clean KPI cards, sidebar, topbar; OnboardingTour modal blocks first view until dismissed |
| Contacts | `/contacts` | Rendered (`1759` chars, `overflowX: false`) | Rendered (`overflowX: false`) | Functional list & filters |
| Smart Lists | `/smart-lists` | Rendered (`1621` chars, `overflowX: false`) | N/A | Returns `503` on `/api/crm/v2/smart-lists` when PostgreSQL is unconfigured (`!pgPool`); honest error handling |
| Workflow Studio | `/workflows` | Rendered (`2350` chars, `overflowX: false`) | Rendered (`overflowX: false`) | **Mobile overlap defect:** floating `Operza Copilot 2.0 AI` pill overlaps bottom action buttons (`Step List`, `Test Run`, `Validate`) at `390x844` |
| Integrations Hub | `/integrations` | Rendered (`4810` chars, `overflowX: false`) | Rendered (`overflowX: false`) | Clean tabbed layout |
| AI Studio | `/ai-trainer` | Rendered (`4092` chars, `overflowX: false`) | Rendered (`overflowX: false`) | Clean tabbed layout |
| Marketplace | `/apps` | Rendered (`12404` chars, `overflowX: false`) | Rendered (`overflowX: false`) | Clean directory; `/api/marketplace/installations` returns `503` in `!pgPool` JSON mode |
| BI Studio | `/reporting` | Rendered (`3252` chars, `overflowX: false`) | N/A | Clean Command Center + BI Studio 2.0 tabs |
| Calendar | `/calendars` | Rendered (`1830` chars, `overflowX: false`) | N/A | Clean |
| Websites | `/websites` | Rendered (`1807` chars, `overflowX: false`) | N/A | Clean |
| Funnels | `/funnels` | Rendered (`1802` chars, `overflowX: false`) | N/A | Clean |
| Plan & Usage (Billing) | `/plan-usage` | **CRASHED** (`bodyTextLen: 0`, blank white screen) | N/A | **CRITICAL:** `TypeError: Cannot read properties of undefined (reading 'toLocaleString')` at `PlanUsage.tsx:301` crashes the entire React tree (no ErrorBoundary) |
| Payments | `/payments` | Rendered (`1947` chars, `overflowX: false`) | N/A | Clean |
| Agency Settings | `/settings` | Rendered (`1776` chars, `overflowX: false`) | N/A | Clean |
| Sub-Accounts | `/sub-accounts` | Rendered (`1630` chars, `overflowX: false`) | N/A | Clean |
| Developer Hub | `/developers` | Rendered (`1521` chars, `overflowX: false`) | N/A | Clean |

---

## 2. Confirmed UI/UX Defects Found in Live Browser Audit

1. **UI-CRIT-001 — `/plan-usage` Uncaught Render Crash (`PlanUsage.tsx:301`):**
   - `p.limits?.workflowRunsPerMonth.toLocaleString()` and `p.limits?.copilotRequestsPerMonth.toLocaleString()` throw when `workflowRunsPerMonth` or `copilotRequestsPerMonth` is `undefined`.
   - Because `AppShell.tsx` has no React `ErrorBoundary` wrapping `{children ?? <Outlet />}`, the entire application renders a blank white screen.
2. **UI-HIGH-001 — Mobile Floating Copilot Pill Overlaps Bottom Controls (`CopilotHub.tsx`):**
   - On `390x844` mobile viewports (observed in `workflows_mobile.png`), the fixed-position `Operza Copilot 2.0 AI` pill sits directly over bottom action buttons (`Step List`, `Test Run`, `Validate`).
3. **UI-MED-001 — Competitor Brand Copy in `OnboardingTour.tsx` & `CopilotHub.tsx`:**
   - `OnboardingTour.tsx` (lines 22, 44, 47, 58, 75) and `CopilotHub.tsx` (line 23) still contain competitor names (`HubSpot`, `GoHighLevel`, `n8n`, `WordPress`, `Twilio`), inconsistent with the SEO negative-filter policy.
4. **UI-INFO-001 — Accessibility Landmarks Verified:**
   - `a.skip-link` and `#main-content` are present across all 15 non-crashed authenticated routes, `overflowX: false` on all tested desktop & mobile viewports, and `brokenImgs: 0`.
