# Analytics Architecture Audit — Product Advancement Stage 6

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Baseline Commit:** `dad6e8e`

## 1. Baseline Triage
Reproduced prior to Stage 6 edits:
- `apps/api/test/phase-2b-independent-verification.test.mjs` (`3.1 Concurrent verification`): 1 failure (`5 !== 9`, pre-existing).
- `apps/api/test/release-verification-gaps.test.mjs` (tests `3` & `4`): 2 failures (pre-existing).
- `packages/platform-core/test/provider-adapters.test.mjs` (`Stripe remains disabled`): 1 failure (`INVALID_CREDENTIAL_FORMAT !== PAYMENTS_DISABLED_PENDING_COMPLIANCE`, pre-existing).

## 2. Existing Reporting Capabilities (Verified in Codebase)
- `packages/db/lib/reporting-repository.mjs` (54 lines): Computes `contactsCount`, `opportunitiesByStatus`, `appointmentsByStatus`, and `paymentsByCurrencyAndStatus` inside `TenantTx` (grouping payments by `currency, status`).
- `apps/api/routes/phase7.mjs`: Exposes `GET /api/reports/summary`.
- `apps/web/src/pages/Reporting.tsx`: Renders charts (`BarChart`, `Donut`, `LineChart`, `Spark`) mostly from in-memory `useStore()` state.

## 3. Gaps Identified
| Area | Current State | Risk / Gap | Stage 6 Target |
| :--- | :--- | :--- | :--- |
| **Semantic Metric Layer** | Ad-hoc queries & client-side `metricInRange` | Inconsistent definitions; missing CRM, Workflow 2.0, Integration 2.0, AI 2.0, Marketplace 2.0, and SaaS metrics | `METRIC_CATALOG_V2` (`analytics-2-0.mjs`) with formal definitions across all 10 categories |
| **Financial & Currency** | `paymentsByCurrencyAndStatus` only | No unified minor-unit gross/refund/net separation or invoice/ledger reconciliation | `aggregateFinancialsByCurrency` strictly separating currencies, integer `amount_cents`, and excluding failed/pending attempts |
| **Custom Report Builder** | None | Users cannot build custom dimensions/measures/filters safely | Allowlisted `buildSafeReportQuery` with strict field/operator allowlists, permission checks, and bounded `limit <= 500` |
| **Dashboards, Schedules & Alerts** | In-memory `savedReports` | No PostgreSQL persistence, private vs agency visibility, scheduled reports, or threshold alerts | `045_analytics_2_0.sql` (`analytics_saved_dashboards`, `analytics_saved_reports`, `analytics_scheduled_reports`, `analytics_threshold_alerts`, `analytics_events`) |
| **UI** | `Reporting.tsx` client-side calculations | Lacks BI Studio 2.0 tabs for Executive Overview, Custom Report Builder, Saved Dashboards, Alerts & Exports | `BiStudio2Panel.tsx` in `Reporting.tsx` powered by TanStack Query |
