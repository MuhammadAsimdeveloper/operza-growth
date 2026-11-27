# Testing & Browser Verification — Stage 15

## 1. Focused & PostgreSQL/RLS Tests
- `node --test packages/platform-core/test/unified-inbox-2-0.test.mjs`: **2/2 pass, 0 fail**
  - Unit suite: conversation/ticket lifecycle transitions, channel connection status honesty, SLA business-hours calculation (`America/New_York`), saved reply template variable validation & HTML escaping, AI support redaction & unavailable honesty, workflow event construction & loop prevention.
  - Real PostgreSQL + `FORCE ROW LEVEL SECURITY` (`operza_app`): Migration `051_unified_inbox_support_2_0.sql`, cross-tenant isolation, assignment optimistic concurrency (`ASSIGNMENT_VERSION_CONFLICT`), internal note privacy (`includeInternalNotes: false`), inbound message deduplication (`providerMessageId`), ticket reopening (`reopenedCount`), Customer 360 financial gating (`includeFinancials`), and support dashboard metrics.

## 2. Full Platform Regression Suites
- `npm --workspace=@operza/platform-core test`: **212 pass, 0 fail, 1 skipped** (`213` total; `Live Provider Sandbox Network Gate` skipped without live credentials)
- `npm --workspace=@operza/api test`: **189 pass, 0 fail**
- `npm --workspace=@operza/workflow-engine test`: **86 pass, 0 fail**
- `npm --workspace=@operza/action-governance test`: **6 pass, 0 fail**
- `node --test packages/ui/test/ui.test.mjs`: **1 pass, 0 fail**
- `node scripts/test-e2e.mjs`: **116 pass, 0 fail**
- `npm --workspace=@operza/web run typecheck`: **pass (0 errors across the entire workspace, including `CommerceHub2Panel.tsx`, `EngagementHub2Panel.tsx`, `PortalHub2Panel.tsx`, and `SitesHub2Panel.tsx`)**
- `npm --workspace=@operza/web run build`: **pass** (`271 modules transformed`, `12` static routes prerendered)
- `npm --workspace=apps/marketing run build`: **pass**
- `node scripts/seo-audit/run-seo-checks.mjs`: **pass**

## 3. Playwright Browser Verification (`/conversations`)
- Tested at `1440x900` (desktop), `768x1024` (tablet), `390x844` (mobile), `360x800` (mobile):
  - `overflow: false` on all 4 viewports.
  - `hasHeading: true` and `hasViews: true` on all 4 viewports.
  - `pageErrorsCount: 0`.
  - Visual screenshot inspection verified 4-column desktop layout, 2-column tablet stacking, 1-column mobile stacking, SLA/metrics strip, and empty states.
