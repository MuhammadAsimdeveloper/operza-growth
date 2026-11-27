# Stage 8 — Frontend Quality Audit

**Date:** 2026-11-27  
**Baseline Commit:** `044f203`

---

## 1. Design System & Component Consistency
- **Tokens & Primitives:** `apps/web/src/styles/tokens.css` defines Rune Light/Dark tokens, spacing (`--space-1`..`--space-8`), z-index layers, `.skip-link`, and `prefers-reduced-motion`. `@operza/ui` exports `Button`, `Input`, `Select`, `Card`, `LoadingState`, `ErrorState`, `Pagination`, `Skeleton`, and `Alert` (`packages/ui/test/ui.test.mjs` passes `1/1`).
- **TypeScript & Build Health:** `npm --workspace=@operza/web run typecheck` (`0` errors) and `vite build` (`265` modules, `12` prerendered routes) pass cleanly.
- **State Management:** Workspace pages use `useQuery` / `@tanstack/react-query` + `request<T>()`/`api` from `apps/web/src/lib/api.ts`, while legacy `store.tsx` remains for client UI preferences.

## 2. Live Browser Quality Findings (Playwright `1.65.1`)
1. **Page Crash (`/plan-usage`):** `PlanUsage.tsx:301` calls `.toLocaleString()` on `undefined` limit fields, crashing the React tree (`TypeError`).
2. **Missing Route ErrorBoundary (`AppShell.tsx`):** No `ErrorBoundary` wraps `{children ?? <Outlet />}`, so any single-page render error white-screens the entire shell.
3. **Mobile Copilot Pill Overlap (`CopilotHub.tsx`):** On `390x844` mobile viewports, the floating `Operza Copilot 2.0 AI` launcher overlaps bottom-right page action buttons (observed on `/workflows`).
4. **Competitor Brand Leakage in Copy:** `OnboardingTour.tsx` (lines 22, 44, 47, 58, 75) and `CopilotHub.tsx` (line 23) still mention `HubSpot`, `GoHighLevel`, `n8n`, `WordPress`, and `Twilio`.
5. **Accessibility & Layout:** `a.skip-link` and `#main-content` verified on all 15 rendered routes; zero horizontal overflow (`scrollWidth === clientWidth`) on desktop (`1440px`) and mobile (`390px`); zero broken images.
