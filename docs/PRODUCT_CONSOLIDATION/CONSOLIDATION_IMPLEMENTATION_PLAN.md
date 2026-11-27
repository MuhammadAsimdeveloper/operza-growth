# Stage 8 — Consolidation Implementation Plan (Pass B)

**Date:** 2026-11-27  
**Baseline Commit:** `044f203`

Pass B addresses only confirmed defects from Pass A, grouped into small, reviewable, test-driven fixes:

1. **Fix `TD-001` & `TD-006` (Frontend Crash, ErrorBoundary, Mobile Overlap & Copy Hygiene):**
   - Add null-safe numeric formatting in `apps/web/src/pages/PlanUsage.tsx`.
   - Add a `RouteErrorBoundary` around `{children ?? <Outlet />}` in `apps/web/src/components/AppShell.tsx`.
   - Reposition/adjust `CopilotHub.tsx` on mobile (`<640px`) or add bottom clearance so it does not overlap action buttons, and scrub competitor names from `OnboardingTour.tsx` & `CopilotHub.tsx`.
2. **Fix `TD-002` (Legacy Workflow `!pgPool` Contract):**
   - Update `apps/api/routes/workflows.mjs` (`POST /api/crm/workflows`) so `!pgPool` mode preserves `actions` and `trigger` alongside `nodes` and `triggerConfig`.
3. **Fix `TD-003` (Calendar Sync Error Normalization & Stale Test Fixture):**
   - Wrap `adapter.verify(...)` errors in `packages/platform-core/src/calendar-sync.mjs` with `code: 'CALENDAR_AUTH_FAILED'`.
   - Update `packages/platform-core/test/calendar-sync.test.mjs` to use a dynamic future appointment date (`Date.now() + 86400000`) instead of hardcoded `2026-11-26`.
4. **Fix `TD-004` & `TD-005` (Baseline Test & Adapter Alignment):**
   - Update `apps/api/test/phase-2b-independent-verification.test.mjs` Test `3.1` to expect `1` x `200` and `9` rejections (`400` or `429` due to OTP rate limiting).
   - Inspect and align `stripePaymentAdapter` in `packages/platform-core/src/provider-adapters.mjs` so `PAYMENTS_DISABLED_PENDING_COMPLIANCE` is returned consistently when Stripe is disabled pending compliance.
5. **Re-Verify Everything:**
   - Re-run Playwright live browser audit on `/plan-usage` and `/workflows` mobile.
   - Re-run `@operza/platform-core`, `@operza/db`, `@operza/api`, `@operza/workflow-engine`, `@operza/action-governance`, `@operza/ui`, `verify-ci-postgres.mjs`, `@operza/web` `typecheck` & `build`, `apps/marketing` `build`, `run-seo-checks.mjs`, `test-e2e.mjs`, and `git diff --check`.
