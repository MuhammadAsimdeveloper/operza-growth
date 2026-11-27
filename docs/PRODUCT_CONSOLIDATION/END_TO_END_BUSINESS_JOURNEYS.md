# Stage 8 — End-to-End Business Journeys Validation

**Date:** 2026-11-27  
**Baseline Commit:** `044f203`

Each cross-module journey was evaluated against live API routes, PostgreSQL repositories, `scripts/test-e2e.mjs` (`116/116`), unit/integration suites, and Playwright UI audit.

---

## Journey A: Lead to Customer
- **Flow:** Contact create/import -> assign -> classify -> tag -> opportunity -> pipeline move -> tasks & appointments -> communication -> won -> CRM & analytics reflection.
- **Evidence:** Verified across `scripts/test-e2e.mjs` (Tests 4–6, 9, 13), `contacts-api.test.mjs`, `opportunities-api.test.mjs`, `pipelines-api.test.mjs`, `scheduling-api.test.mjs`, and `analytics-2-0.test.mjs`.
- **Gap:** Large CSV imports (>25k rows) execute synchronously in `parseAndValidateCsvImport`; UI `/contacts` & `/opportunities` work cleanly.
- **Status:** **PASS (Synchronous Import Caveat)**

## Journey B: Automated Lead Handling
- **Flow:** Form/webhook -> contact -> trigger workflow -> conditions -> CRM actions -> AI classify -> approval gate -> complete -> execution logs -> analytics.
- **Evidence:** Verified across `scripts/test-e2e.mjs` (Tests 11, 102, 108, 109), `workflows-api.test.mjs`, `workflow-persistence-reliability.test.mjs`, and `workflow-2-0.test.mjs`.
- **Gap:** Legacy `POST /api/crm/workflows` in `!pgPool` mode drops `actions` & `trigger` (`release-verification-gaps.test.mjs` Tests 3 & 4).
- **Status:** **PARTIAL (Defect in legacy `!pgPool` workflow creation — targeted for Pass B)**

## Journey C: Integration to Workflow
- **Flow:** Connect sandbox app -> verify scopes -> signed webhook -> deduplicate -> normalize -> start workflow -> approved connector action -> delivery state -> audit trail.
- **Evidence:** Verified across `integrations-2-0.test.mjs` (`Connector SDK 2.0`, `OAuth Lifecycle Engine 2.0`, `Webhook Platform 2.0`, `Data Sync Engine 2.0`), `zapier-authz.test.mjs`, `zapier-endpoints.test.mjs`, and `test-e2e.mjs` (Tests 110–114).
- **Gap:** Live third-party OAuth/webhooks remain in sandbox/mocked-fetch mode pending staging credentials; calendar sync tests fail on stale fixture date & unwrapped verify error.
- **Status:** **PARTIAL (Calendar sync defect — targeted for Pass B; live external providers blocked by policy)**

## Journey D: AI Business Assistant
- **Flow:** Configure agent -> select model -> assign tools -> connect knowledge -> submit request -> validate plan -> read-only tools -> propose sensitive action -> human approval -> execute -> evidence -> record usage/cost.
- **Evidence:** Verified across `ai-2-0.test.mjs` (Model Router, Orchestrator, Memory Manager, RAG V2, Eval Suite V2), `phase5-ai-platform.test.mjs`, and `test-e2e.mjs` (Tests 8, 101).
- **Gap:** Live paid LLM inference is disabled locally; Plan & Usage screen (`/plan-usage`) crashes on `undefined.toLocaleString()`.
- **Status:** **PARTIAL (`/plan-usage` crash — targeted for Pass B; live LLM blocked by policy)**

## Journey E: Marketplace
- **Flow:** Publisher -> submit app -> review & approve -> publish version -> install -> review permissions -> use in workflow -> upgrade -> re-consent scopes -> uninstall/revoke.
- **Evidence:** Verified in `marketplace-2-0.test.mjs` (manifest validator, semver downgrade defense, scope escalation, lifecycle transitions) and `marketplace-2-repository.mjs` under real PostgreSQL `FORCE RLS`.
- **Gap:** Live paid marketplace checkout/payouts deferred pending Stripe Connect compliance.
- **Status:** **PASS (Monetization deferred)**

## Journey F: Business Reporting
- **Flow:** Generate records -> verify source metrics -> executive dashboard -> custom report -> save -> export authorized results -> currency handling -> tenant isolation.
- **Evidence:** Verified in `analytics-2-0.test.mjs` (10-category catalog, minor-unit currency separation, allowlisted query builder, PII redaction, CSV formula defense, alert cooldown) and `BiStudio2Panel.tsx`.
- **Gap:** Scheduled report email delivery requires staging worker + live email provider.
- **Status:** **PASS (Scheduled email delivery requires staging worker)**

## Journey G: Site and Booking
- **Flow:** Create site/funnel -> configure form -> publish -> submit form -> create/update contact -> book appointment -> timezone/availability -> trigger automation -> verify analytics.
- **Evidence:** Verified in `test-e2e.mjs` (Tests 9, 105, 107), `appointment-concurrency-api.test.mjs`, and `funnels-api.test.mjs`.
- **Status:** **PASS**
