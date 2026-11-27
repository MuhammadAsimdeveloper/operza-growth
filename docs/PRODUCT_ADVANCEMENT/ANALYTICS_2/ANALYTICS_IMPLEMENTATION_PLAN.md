# Analytics & Business Intelligence 2.0 — Implementation Plan

**Date:** 2026-11-27  
**Stage:** Product Advancement Stage 6

## 1. Implementation Phases
1. **Database Schema & `FORCE RLS` (`packages/db/migrations/045_analytics_2_0.sql`):**
   - `analytics_saved_dashboards`, `analytics_saved_reports`, `analytics_scheduled_reports`, `analytics_threshold_alerts`, `analytics_events` (idempotent deduplication).
   - `FORCE ROW LEVEL SECURITY` + `operza_app` and `operza_worker` grants on all 5 tables.
2. **Core BI Engine (`packages/platform-core/src/analytics-2-0.mjs`):**
   - `METRIC_CATALOG_V2` across 10 domains (`crm`, `sales`, `financial`, `scheduling`, `communication`, `workflow`, `integration`, `ai`, `marketplace`, `saas`).
   - `aggregateFinancialsByCurrency` (currency-separated minor-unit integer math).
   - `buildSafeReportQuery` (allowlisted sources/dimensions/measures/filters, zero arbitrary SQL, bounded rows).
   - `computeFunnelConversion`, `redactExportRows`, `formatSafeCsv`, and `evaluateThresholdAlert`.
3. **Repository & API (`packages/db/lib/analytics-2-repository.mjs`, `apps/api/routes/analytics2.mjs`):**
   - Strictly `TenantTx`-scoped Executive Overview 2.0 (cross-module real SQL aggregations), Custom Report runner, Saved Dashboards/Reports (`private` vs `agency` visibility), Scheduled Reports, Threshold Alerts, Event Ingestion, and Redacted CSV/JSON Exports.
4. **Frontend BI Studio 2.0 (`apps/web/src/components/BiStudio2Panel.tsx` in `Reporting.tsx`):**
   - Tabbed workspace using TanStack Query (`useQuery`).
5. **Verification & Documentation:**
   - Metric correctness, currency/timezone, security, and real PostgreSQL `FORCE RLS` tests + 10 `ANALYTICS_2` docs.
