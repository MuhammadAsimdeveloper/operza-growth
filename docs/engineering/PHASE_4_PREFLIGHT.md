# Phase 4 Preflight — Automation V2 & Integration Hub SDK

**Date:** 2026-11-25
**Repository:** `MuhammadAsimdeveloper/operza-growth` (`C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`)
**Branch:** `feat/operza-agency-launch-readiness`
**Baseline HEAD:** `bba9609376e9b602e071b5b354ed94eef859cf75` (`feat(phase-3): implement stripe connect sandbox adapter, provider status webhooks, invoice pdfs, and durable dunning`)
**Working Tree:** Clean, `[ahead 9]` relative to `origin/feat/operza-agency-launch-readiness`

---

## 1. Phase 3 Verification Summary
- Migration 036 (`stripe_connect_accounts`, `payment_links`, `coupons`, `dunning_attempts`) verified under `FORCE ROW LEVEL SECURITY` (`130/130` PG CI).
- `stripePaymentAdapter` (`payments.stripe`) verified in sandbox mode with `Idempotency-Key`; Twilio/SendGrid delivery/event webhooks, server-side Invoice PDFs (`%PDF-1.4`), and durable Dunning verified (`7/7` unit/API tests, `116/116` E2E).

---

## 2. Phase 4 Scope & Acceptance Criteria
1. **Workflow Optimistic Versioning (`packages/db/lib/workflows-repository.mjs`, `apps/api/routes/workflows.mjs`)**:
   - Enforce `expectedVersion` (or `version`) check in `UPDATE workflow_definitions ... WHERE ... AND version = $10`, throwing `VERSION_CONFLICT` mapped to HTTP `409 Conflict` when stale.
   - Verify concurrent updates in real PostgreSQL.
2. **Integration Hub SDK (`packages/platform-core/src/integration-sdk.mjs`)**:
   - Standardized registration contract (`id`, `name`, `provider`, `version`, `authType`, `triggers`, `actions`, `webhooks`, `rateLimitPolicy`, `validateConfig`, `testConnection`, `executeAction`).
   - Built-in per-tenant / per-provider token-bucket rate limiter, circuit-breaker / failure normalization, secret redaction, and safe execution without dynamic `eval`/`new Function`.
   - Register core adapters (`stripe`, `twilio`, `sendgrid`, `resend`, `whatsapp`, `zapier`, plus catalog connectors from `connector-catalog.mjs` with explicit truthful maturity statuses).
3. **Visual Workflow Builder V2 (`apps/web/src/components/WorkflowCanvas.tsx`)**:
   - Upgrade with `@xyflow/react` (interactive graph pan/zoom, minimap, controls, node selection, edge routing, and execution overlay) while preserving step inspection and dry-run capabilities.
4. **1,000-Job Chaos & Concurrency Harness (`packages/workflow-engine/test/chaos-1000-jobs.test.mjs`)**:
   - Execute 1,000 concurrent workflow jobs across multiple workers with injected failures (provider timeouts, rate limits, worker lease expiry/crash, duplicate events).
   - Assert **zero lost durable jobs** and **zero duplicate protected financial/messaging side effects**.
