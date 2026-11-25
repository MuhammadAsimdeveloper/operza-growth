# Phase 1.6 Completion Report & Milestone Certification
## Pipelines & Funnels Domain Extraction & TenantTx Persistence Boundary

**Repository:** `MuhammadAsimdeveloper/operza-growth`  
**Workspace:** `C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `ed721a7` (`refactor(workflows): modularize workflows domain and establish tenant-scoped repository`)  
**Certification Status:** **COMPLETE & VERIFIED**  
**Date:** 2026-11-25  

---

## 1. Executive Summary

Phase 1.6 extracted the **Pipelines** and **Funnels & Websites** domains out of the monolithic `apps/api/server.mjs` and generic collection handlers into dedicated `TenantTx`-scoped repositories and modular HTTP routers:

1. **`PipelinesRepository` (`packages/db/lib/pipelines-repository.mjs`)**:
   - Persists to dedicated Migration 011 PostgreSQL tables `pipelines` and `pipeline_stages` with `FORCE ROW LEVEL SECURITY`.
   - Atomically synchronizes normalized `pipeline_stages` rows inside `TenantTx` on create and update, and cascades deletion.
2. **`FunnelsRepository` (`packages/db/lib/funnels-repository.mjs`)**:
   - Persists funnels and websites (`collection = 'websites'`) in `location_records` via `TenantTx` with RLS.
   - Tracks `visits` and `optins` counters atomically.
3. **Modular Routers (`apps/api/routes/pipelines.mjs` & `apps/api/routes/funnels.mjs`)**:
   - `pipelines.mjs`: handles `/api/crm/pipelines*` and `/api/pipelines*` with `pipelines:read` / `pipelines:write` scope enforcement and `opportunities:*` fallback.
   - `funnels.mjs`: handles authenticated `/api/crm/websites*` and `/api/crm/funnels*`, plus public `/api/funnels/public/:slugOrId`, `/api/websites/public/:slugOrId`, `/api/funnels/optin/:slugOrId`, `/api/websites/optin/:slugOrId`, and `/api/funnels/checkout/one-click-upsell`.
   - Removed duplicate inline funnel, opt-in, and upsell blocks from `apps/api/server.mjs`.

---

## 2. Verification Evidence Matrix

| Gate | Command | Exit Code | Result |
|---|---|:---:|---|
| Syntax Check | `node --check apps/api/server.mjs` | 0 | **PASS** |
| Domain Unit Tests | `node --test packages/db/test/... apps/api/test/...` | 0 | **31/31 passed** |
| Real PostgreSQL CI & RLS | `node scripts/verify-ci-postgres.mjs` | 0 | **130/130 passed** (incl. real PG Pipelines/Funnels RLS tests) |
| System E2E Suite | `node scripts/test-e2e.mjs` | 0 | **116/116 passed** |
| Frontend Typecheck | `npm --workspace=@operza/web run typecheck` | 0 | **PASS** |
| Frontend Build & Prerender | `npm --workspace=@operza/web run build` | 0 | **PASS** (12 public routes) |
| SEO & Metadata Audit | `node scripts/seo-audit/run-seo-checks.mjs` | 0 | **106/106 passed** |
| Git Whitespace Check | `git diff --check` | 0 | **0 errors** |

---

## 3. Known Limitations & Remaining Scope
- Public funnel opt-in (`POST /api/funnels/optin/:slugOrId`) and 1-click upsell (`POST /api/funnels/checkout/one-click-upsell`) still update `state.records.contacts`, `state.records.opportunities`, `state.records.orders`, and `state.records.payments` in-memory when `!pgPool`, and orders/payments/contacts extraction in public checkout flows will be unified with PostgreSQL in **Phase 1.7 (Payments, Orders, Invoices & Ledger Domain Extraction)**.

---

## 4. Next Milestones
1. **Phase 1.7 — Payments, Orders, Invoices & Ledger Domain Extraction** (`billing_ledger_accounts`, `billing_ledger_entries`, `routes/payments.mjs`).
2. **Phase 1.8 — Messaging, Conversations & Consents Domain Extraction** (`communication_consents`, `routes/conversations.mjs`).
