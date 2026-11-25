# Phase 1.6 Pre-Flight Audit & Next Milestone Scope
## Pipelines & Funnels Domain Extraction & TenantTx Persistence Boundary

**Repository:** `C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`  
**GitHub Remote:** `MuhammadAsimdeveloper/operza-growth`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Verified Baseline HEAD:** `ed721a7` (`refactor(workflows): modularize workflows domain and establish tenant-scoped repository`)  
**Master-Plan Reference:** `docs/plans/02_MASTER_PLAN.md` §B Phase 1 (Items 2, 5, 6), `docs/engineering/PHASE_1_5_COMPLETION_REPORT.md` §4  
**Status:** Pre-flight Audited & Phase 1.6 Formally Selected  
**Date:** 2026-11-25  

---

## 1. Verified Repository Baseline & Phase 1.5 Audit

### 1.1 Git State
- `git status --short --branch`: `## feat/operza-agency-launch-readiness...origin/feat/operza-agency-launch-readiness [ahead 3]` (clean working tree)
- `git rev-parse HEAD`: `ed721a703df65ac076d8017f88efacb7bae41bc4`
- `git branch --show-current`: `feat/operza-agency-launch-readiness`

### 1.2 Independent Phase 0–1.5 Verification Summary
| Phase | Milestone | Audit Verdict | Observed Evidence |
|---|---|---|---|
| **Phase 0** | Honest Architecture Certification | **VERIFIED** | Commits `cad24a0`, `29a5af7`, `70281af`; fail-closed webhooks/checkout/vault verified in E2E & unit tests |
| **Phase 1.1** | Foundation Re-Platform & `TenantTx` | **VERIFIED** | `packages/db/test/tenant-tx.test.mjs` (11/11 passed, exit code 0) |
| **Phase 1.2** | Contacts Domain Extraction | **VERIFIED** | `contacts-repository.test.mjs` (5/5 passed), `contacts-api.test.mjs` (1/1 passed), real PG merge tested |
| **Phase 1.3** | Opportunities Domain Extraction | **VERIFIED** | `opportunities-repository.test.mjs` (4/4 passed), `opportunities-api.test.mjs` (1/1 passed) |
| **Phase 1.4** | Scheduling Domain Extraction | **VERIFIED** | `scheduling-repository.test.mjs` (2/2 passed), `scheduling-api.test.mjs` (1/1 passed), GiST `23P01` concurrency verified |
| **Phase 1.5** | Workflows & Executions Extraction | **PARTIALLY VERIFIED / VERIFIED** | `workflows-repository.test.mjs` (1/1 passed, mock pool), `workflows-api.test.mjs` (1/1 passed), `workflow-wait-lifecycle.test.mjs` + `workflow-persistence-reliability.test.mjs` (17/17 passed with real PG), E2E (116/116 passed). Minor note: `WorkflowsRepository.updateWorkflow` increments `version` but does not enforce `WHERE version = $expected` optimistic locking if a stale `version` is passed. |

---

## 2. Remaining Milestones Inventory

| Phase | Exact Title | Main Objective | Dependencies | Current Status |
|---|---|---|---|---|
| **Phase 1.6** | Pipelines & Funnels Domain Extraction & TenantTx Boundary | Extract `PipelinesRepository` (`pipelines`, `pipeline_stages`), `FunnelsRepository` (`location_records` websites/funnels), `routes/pipelines.mjs`, `routes/funnels.mjs` | Phases 1.1–1.5, Migration 011 | **Unstarted (Selected Next)** |
| **Phase 1.7** | Payments, Orders, Invoices & Ledger Domain Extraction | Extract `CommerceRepository` & `routes/payments.mjs` over `billing_ledger_*` & `location_records` | Phases 1.1–1.6, Migration 013 | **Unstarted** |
| **Phase 1.8** | Messaging, Conversations & Consents Extraction | Extract `MessagingRepository` & `routes/conversations.mjs` over `communication_consents` & messaging tables | Phases 1.1–1.7, Migration 008 | **Unstarted** |
| **Phase 1.9** | Forms, Tasks, Reviews, Auth/Agency & Monolith Retirement | Extract remaining `server.mjs` domains + evaluate Fastify/OpenAPI swap | Phases 1.1–1.8 | **Unstarted** |
| **Phase 2** | Frontend Rebuild on Real Data Layer | Replace `store.tsx`/`seed.ts` business state with TanStack Query + `packages/ui` | Phase 1 complete | **Unstarted** |
| **Phase 3** | Real Channels & Real Money | Live Stripe/Twilio/SendGrid/WhatsApp/A2P Trust Hub sandbox E2E & PDF/dunning | Phase 1.7, 1.8 | **Partially Implemented** |
| **Phase 4** | Automation v2 + Integration Hub SDK | `@xyflow/react` canvas, 25-integration SDK catalog, 1000-job chaos tests | Phase 1.5, Phase 2 | **Partially Implemented** |
| **Phase 5** | Real AI | pgvector RAG, tool registry, Voice AI streaming, eval gates | Phase 1.8, Phase 3 | **Partially Implemented** |
| **Phase 6** | Funnels/Sites v2 SSR, Calendar v2, Custom Domains + SSL | Server-rendered tenant funnels/sites on custom domains with auto-SSL | Phase 1.6, Astro SSR | **Partially Implemented** |
| **Phase 7** | SaaS Mode, White-Label, Marketplace, Public OAuth Apps | Stripe Connect agency SaaS, metered wallets, OAuth apps | Phase 3, Phase 6 | **Partially Implemented** |
| **Phase 8** | Launch Hardening | OWASP ASVS L2, k6 load, backup/restore drill, chaos, GDPR | Phases 1–7 | **Unstarted** |

---

## 3. Phase 1.6 Scope & Deliverables

### 3.1 Deliverables
1. **`packages/db/lib/pipelines-repository.mjs`**:
   - Backed by Migration 011 tables `pipelines` and `pipeline_stages` (already enforced with `FORCE ROW LEVEL SECURITY` and `operza_app` grants).
   - Methods: `createPipeline`, `getPipelineById`, `listPipelines`, `updatePipeline`, `deletePipeline`, `listStages`, `upsertStage`, `deleteStage`.
   - Atomically syncs `pipeline_stages` rows when creating/updating a pipeline inside `TenantTx`.
2. **`packages/db/lib/funnels-repository.mjs`**:
   - Backed by `location_records` (`collection = 'websites'`) inside `TenantTx` (supporting both `kind: 'funnel'` and `kind: 'website'` without destructive schema changes).
   - Methods: `createFunnel`, `getFunnelById`, `getFunnelBySlugOrId`, `listFunnels`, `updateFunnel`, `deleteFunnel`, `recordVisit`, `recordOptin`.
3. **Export in `packages/db/lib/database.mjs`**:
   - Export `createPipelinesRepository` and `createFunnelsRepository`.
4. **`apps/api/routes/pipelines.mjs`**:
   - Handles `/api/crm/pipelines*` and `/api/pipelines*`.
   - Enforces `pipelines:read` / `pipelines:write` (with `opportunities:read` / `opportunities:write` compatibility).
   - Strips client-supplied `agencyId`/`locationId`.
   - Zero dual-writing when `pgPool` is configured.
5. **`apps/api/routes/funnels.mjs`**:
   - Handles authenticated `/api/crm/websites*` and `/api/crm/funnels*`.
   - Handles public `/api/funnels/public/:slugOrId`, `/api/websites/public/:slugOrId`, `/api/funnels/optin/:slugOrId`, `/api/websites/optin/:slugOrId`, and `/api/funnels/checkout/one-click-upsell`.
   - Preserves cross-domain opt-in flow (contact upsert, opportunity creation, workflow trigger) and 1-click upsell order/payment recording.
6. **Router Wiring & Legacy Cleanup**:
   - Wire `handlePipelinesRoutes` and `handleFunnelsRoutes` into `apps/api/routes/crm.mjs` and `apps/api/server.mjs`.
   - Remove duplicate inline funnel/upsell/website handlers from `apps/api/server.mjs`.

### 3.2 Acceptance Criteria
- All new repository and API contract tests pass (`pipelines-repository.test.mjs`, `funnels-repository.test.mjs`, `pipelines-api.test.mjs`, `funnels-api.test.mjs`).
- Real PostgreSQL `pipelines` and `pipeline_stages` CRUD + RLS tenant isolation verified in `real-postgres-integration.test.mjs`.
- Full system regression passes: domain unit tests, `verify-ci-postgres.mjs`, `test-e2e.mjs` (116/116), `typecheck`, `build`, `run-seo-checks.mjs` (106/106), and `git diff --check`.
