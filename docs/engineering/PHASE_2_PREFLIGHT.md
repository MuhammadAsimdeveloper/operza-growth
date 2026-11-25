# Phase 2 Preflight — Complete Frontend Rebuild on Real Data

**Date:** 2026-11-25
**Repository:** `MuhammadAsimdeveloper/operza-growth` (`C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`)
**Branch:** `feat/operza-agency-launch-readiness`
**Baseline HEAD:** `2c03748c0431009e1ecbdec62de647fe074fac34` (`refactor(phase-1.9): extract forms tasks reviews harden agency auth and retire monolith duplicates`)
**Working Tree:** Clean, `[ahead 7]` relative to `origin/feat/operza-agency-launch-readiness`

---

## 1. Current Frontend Stack & Audit Findings
- **Framework:** React `^18.3.1`, TypeScript `^5.6.3`, Vite `^5.4.9`, `react-router-dom` `^6.26.2`.
- **Existing API Client:** `apps/web/src/lib/api.ts` (fetch wrapper with `credentials: 'include'`, `x-operza-location` header, `operza_csrf` cookie -> `x-operza-csrf`). Missing typed `ApiError` class, `AbortSignal` support, and full Phase 1.9 domain methods.
- **Existing Auth:** `apps/web/src/lib/AuthContext.tsx` (session check on mount, login, signup, Google OAuth, OTP, logout, `switchLocation`). Needs TanStack Query cache clearing on logout and agency/location switch, plus `switchAgency` support.
- **Mock Data Debt:** `apps/web/src/lib/store.tsx` (2,087 lines) + `apps/web/src/lib/seed.ts` are imported by 43 pages, `AppShell.tsx`, and `main.tsx`. `store.tsx` reads/writes `localStorage('operza.workspace.v14')`, falls back to `seed.ts`, and hardcodes `actor: 'Asim R.'`.

---

## 2. Phase 2 Target Architecture
1. **Shared UI Package (`packages/ui`)**:
   - Workspace package `@operza/ui` exporting reusable TypeScript UI primitives (`Button`, `Input`, `Select`, `Badge`, `StatusBadge`, `Card`, `Modal`, `Table`, `EmptyState`, `LoadingState`, `ErrorState`, `Pagination`, `ToastProvider`) aligned with `apps/web/src/styles/tokens.css` & `app.css`.
2. **Typed API Client (`apps/web/src/lib/api.ts`)**:
   - Typed `ApiError` with HTTP `status`, `code`, and `details`.
   - `AbortSignal` support, CSRF + `credentials: 'include'`, `x-operza-location` + `x-operza-agency` headers.
   - Complete typed methods for Auth, Agency, Contacts, Opportunities, Pipelines, Tasks, Calendars/Appointments, Workflows, Funnels/Websites, Forms, Conversations/Consents, Orders/Payments/Invoices/Ledger, Reviews, and Dashboard/Reporting.
3. **TanStack Query (`apps/web/src/lib/query.ts`)**:
   - Centralized `QueryClient` with safe retry rules (no automatic retries on mutations or 401/403/404), tenant-scoped query keys `['tenant', agencyId, locationId, domain, ...]`, and cache clearing on logout / agency switch / location switch.
   - Domain query & mutation hooks in `apps/web/src/hooks/`.
4. **Vertical Slice Migration & Mock Removal**:
   - Migrate Core CRM (Contacts, Opportunities/Pipelines, Tasks), Scheduling (Calendars/Appointments), Automation (Workflows), Funnels & Forms, Conversations & Consents, Commerce (Orders, Payments, Invoices), Reviews, and Agency Administration (Settings, SubAccounts, Branding) to TanStack Query + real APIs.
   - Remove `store.tsx` and `seed.ts` from production runtime (`main.tsx`, `AppShell.tsx`, and migrated pages), retaining only explicit test/dev fixtures where needed.
