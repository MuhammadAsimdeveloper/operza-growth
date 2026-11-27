# Testing & Verification — Stage 14

## 1. Focused Test Suites
- `node --test packages/workflow-engine/test/operations-2-0.test.mjs`: **7/7 pass** (`0` fail). Covers `retry_scheduled` state transitions, operator requeue guard, failure classification, bounded exponential backoff, side-effect retry confirmation, cooperative cancellation contract, payload redaction/truncation, and stuck-execution detection.
- `node --test packages/platform-core/test/workflow-operations-2-0.test.mjs`: **1/1 pass** (`0` fail) against real isolated PostgreSQL (`IsolatedTestPostgres`) with all migrations `001..050` and `operza_app` role (`FORCE ROW LEVEL SECURITY`). Verifies cross-tenant isolation, operational metrics, side-effect confirmation, version preservation, DLQ requeue & duplicate-requeue prevention, stuck recovery, and pause/resume.

## 2. Full Platform Regression Suites
- `npm --workspace=@operza/workflow-engine test`: **86/86 pass** (`0` fail).
- `npm --workspace=@operza/action-governance test`: **6/6 pass** (`0` fail).
- `npm --workspace=@operza/api test`: **189/189 pass** (`0` fail).
- `npm --workspace=@operza/platform-core test`: **210/211 pass** (`0` fail, `1` skipped: `Live Provider Sandbox Network Gate` requiring live sandbox credentials).
- `node --test packages/ui/test/ui.test.mjs`: **1/1 pass** (`0` fail).
- `npm --workspace=@operza/web exec vite -- build`: **pass** (`270 modules transformed`).
- `npm --workspace=apps/marketing run build`: **pass** (`5 page(s) built`).
- `node scripts/seo-audit/run-seo-checks.mjs`: **pass** (`exit code 0`).
- `node scripts/test-e2e.mjs`: **116/116 pass** (`0` fail).

## 3. Browser & Responsive Verification (Playwright)
- Verified `/workflows` with an authenticated agency session across `1440x900` (desktop), `768x1024` (tablet), and `390x844` (mobile):
  - `overflow: false` on all 3 viewports.
  - `hasOpsSection: true` on all 3 viewports.
  - `pageErrorsCount: 0`.
  - Visual screenshot inspection confirmed `Dashboard`, `Executions`, `Dead-Letter`, `Pause`, `Scan Stuck`, filter controls, and empty states render cleanly.
