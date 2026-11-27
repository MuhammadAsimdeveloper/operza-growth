# UI/UX Architecture Audit — Product Advancement Stage 7

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Baseline Commit:** `853381b`

## 1. Baseline Triage
Reproduced prior to Stage 7 edits:
- `apps/api/test/phase-2b-independent-verification.test.mjs` (`3.1 Concurrent verification`): 1 failure (`5 !== 9`, pre-existing).
- `apps/api/test/release-verification-gaps.test.mjs` (tests `3` & `4`): 2 failures (pre-existing).
- `packages/platform-core/test/provider-adapters.test.mjs` (`Stripe remains disabled`): 1 failure (`INVALID_CREDENTIAL_FORMAT !== PAYMENTS_DISABLED_PENDING_COMPLIANCE`, pre-existing).
- `npm --workspace=@operza/web run typecheck` (`tsc -b --noEmit`): Caught TypeScript errors in the Stage 2–6 panel components (`api()` called instead of `request()`, `EmptyState` `body=` prop instead of `text=`, `Badge` `tone="slate"` instead of `'default'`, and `WorkflowRunStep.nodeId`).

## 2. Existing Frontend Architecture (Verified in Codebase)
- **Design Tokens (`apps/web/src/styles/tokens.css`):** Semantic light & dark mode CSS variables (`--bg`, `--surface`, `--layer-01`..`--layer-04`, `--text`, `--text-2`, `--text-3`, `--accent`, `--green`, `--amber`, `--red`, `--blue`, `--violet`, `--focus-ring`, `--sidebar-w`, `--topbar-h`).
- **Shared `@operza/ui` (`packages/ui/src/components.tsx`):** `Button`, `Input`, `Select`, `Card`, `LoadingState`, `ErrorState`, `Pagination` — re-exported by `apps/web/src/components/ui.tsx` alongside `Avatar`, `Badge`, `StatusBadge`, `EmptyState`, `Switch`.
- **App Shell & Routing (`AppShell.tsx`, `App.tsx`, `CommandPalette.tsx`):** Lazy-loaded React 18 routes with `Suspense`, collapsible sidebar with pillar groups, `Ctrl+K` Command Palette, and `AuthContext` calling `clearTenantCache()` + `purgePwaTenantCaches()` on both `logout()` and `switchLocation()`.

## 3. Gaps & Redesign Priorities
| Area | Finding | Stage 7 Action |
| :--- | :--- | :--- |
| **TypeScript Build Integrity** | `tsc -b --noEmit` failed on Stage 2–6 panels (`api()` vs `request()`, `EmptyState` `body=`, `Badge` `slate`, `WorkflowRunStep`) | Fix all 5 panels (`WorkflowGraphV2`, `IntegrationsHub2Panel`, `AiStudio2Panel`, `MarketplaceHub2Panel`, `BiStudio2Panel`) so `tsc -b --noEmit` and `vite build` pass with 0 errors |
| **Design System 2.0 (`@operza/ui`)** | Missing `Skeleton` and `Alert` primitives, spacing scale tokens, and reduced-motion media query | Add `--space-1`..`--space-8` + `@media (prefers-reduced-motion: reduce)` to `tokens.css`; add `Skeleton` & `Alert` to `packages/ui/src/components.tsx` + unit tests |
| **Accessibility (WCAG 2.2 AA)** | No skip-to-main-content link in `AppShell.tsx` | Add `.skip-link` and `#main-content` landmark in `AppShell.tsx` |
| **Documentation** | No unified UI/UX 2.0 design system specification or audit | Author all 9 `UI_UX_2` architecture, design system, responsive, accessibility, and performance docs |
