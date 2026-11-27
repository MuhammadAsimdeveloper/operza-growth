# Testing & Verification — Stage 16

## 1. Focused Cross-Platform & PostgreSQL/RLS Tests
- `packages/platform-core/test/cross-platform-reliability-2-0.test.mjs`: **2/2 pass, 0 fail**
  - Canonical entities, versioned cross-module events (`2.0`), outbox deduplication, loop guard (`loopDepth <= 3`), integration health states, and currency-separated revenue aggregation.
  - End-to-End Business Journeys A–H against real isolated PostgreSQL (`IsolatedTestPostgres`) + `operza_app` (`FORCE ROW LEVEL SECURITY`): Lead -> Customer, Support Ticket & Customer 360, Marketing Suppression, Workflow Retry Eligibility, Billing/Invoices & Financial Gating, Portal Agency Binding & IDOR Protection, Sites Schema Validation, and AI Redaction & Honest Unavailable State.

## 2. Full Regression Suites (Exact Observed Counts)
- `npm --workspace=@operza/platform-core test`: **214 pass, 0 fail, 1 skipped** (`215` total; `Live Provider Sandbox Network Gate` skipped without live sandbox credentials)
- `npm --workspace=@operza/api test`: **189 pass, 0 fail**
- `npm --workspace=@operza/workflow-engine test`: **86 pass, 0 fail**
- `npm --workspace=@operza/action-governance test`: **6 pass, 0 fail**
- `node --test packages/ui/test/ui.test.mjs`: **1 pass, 0 fail**
- `node scripts/test-e2e.mjs`: **116 pass, 0 fail**
- `npm --workspace=@operza/web run typecheck`: **pass (`0` errors)**
- `npm --workspace=@operza/web run build`: **pass** (`271` modules transformed, `12` prerendered routes)
- `npm --workspace=apps/marketing run build`: **pass**
- `node scripts/seo-audit/run-seo-checks.mjs`: **pass** (`exit code 0`)

## 3. Playwright Browser Verification
- `33` checks across `13` routes (`/dashboard`, `/contacts`, `/conversations`, `/campaigns`, `/workflows`, `/integrations`, `/ai-trainer`, `/payments`, `/websites`, `/portal`, `/reporting`, `/apps`, `/settings`) and `6` viewports (`1920x1080`, `1440x900`, `1366x768`, `768x1024`, `390x844`, `360x800`):
  - `overflowCount: 0`
  - `pageErrorsCount: 0`
  - Visual screenshot inspection verified `/reporting` (`1440x900`) and `/dashboard` (`390x844`).
