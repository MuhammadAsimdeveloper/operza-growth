# Testing and Browser Verification — Stage 17 Agency Governance 2.0

## 1. Unit & PostgreSQL FORCE RLS Integration Tests

Suite: `packages/platform-core/test/agency-governance-2-0.test.mjs` (run via `npm --workspace=@operza/platform-core test`):
- `Agency Governance 2.0: RBAC templates, privilege escalation guard, invitation tokens, owner protection & onboarding`: **PASS** (`10.61ms`)
- `Agency Governance 2.0: PostgreSQL Migration 052, FORCE RLS, Locations, Invitations, Custom Roles & Offboarding`: **PASS** (`33192.08ms`)
  - Runs against a real `IsolatedTestPostgres` instance using the `operza_app` role under `FORCE ROW LEVEL SECURITY`.
  - Verifies Migration `052_agency_governance_2_0.sql` idempotency and tenant isolation (`app.agency_id`).
  - Verifies cross-agency workspace slug collision detection (`23505` -> `DUPLICATE_WORKSPACE_SLUG`).
  - Verifies location creation, archive/restore, scoped `user_location_memberships`, invitation token hashing/single-use acceptance, custom role creation with escalation guard, last-owner protection, and offboarding with `auth_sessions` revocation.

## 2. Full Workspace Test & Build Verification

| Check | Command | Observed Result |
| --- | --- | --- |
| `@operza/platform-core` | `npm --workspace=@operza/platform-core test` | **216 pass, 0 fail, 1 pre-existing skipped** (`42388ms`) |
| `@operza/api` | `npm --workspace=@operza/api test` | **189 pass, 0 fail, 0 skipped** (`190894ms`) |
| `@operza/workflow-engine` | `npm --workspace=@operza/workflow-engine test` | **86 pass, 0 fail** |
| `@operza/action-governance` | `npm --workspace=@operza/action-governance test` | **6 pass, 0 fail** |
| `@operza/ui` | `node --test packages/ui/test/ui.test.mjs` | **1 pass, 0 fail** |
| `@operza/web` TypeScript | `npm --workspace=@operza/web run typecheck` | **0 errors** |
| `@operza/web` Vite Build | `npm --workspace=@operza/web run build` | **272 modules transformed, 12 canonical public routes prerendered** |
| `apps/marketing` Build | `npm --workspace=apps/marketing run build` | **PASS** |
| SEO Checks | `node scripts/seo-audit/run-seo-checks.mjs` | **PASS** (`exit code 0`) |
| End-to-End API Suite | `node scripts/test-e2e.mjs` | **116/116 pass, 0 fail** |

## 3. Live Browser & 6-Viewport Playwright Verification

Script: `agency_governance_playwright.mjs` (temporary verification run, **PASS**, `exit code 0`):
- **Interactive Flows Verified on `/settings` (`AgencyGovernance2Panel`):**
  - `Workspace` tab: `Save Agency Profile` persisted workspace profile updates.
  - `Locations` tab: `Add Location` created a new location cleanly.
  - `Team & Invites` tab: `Send Invite` generated an invitation record and `Revoke` revoked it.
  - `Roles` tab: `Create Role` persisted a new custom role.
  - `Security` tab & `Setup` tab: rendered session controls and onboarding checklist without runtime errors.
- **Responsive Viewport Matrix (`24` route/viewport checks):**
  - Routes: `/settings`, `/audit-log`, `/plan-usage`, `/dashboard`
  - Viewports: `1920x1080`, `1440x900`, `1366x768`, `768x1024`, `390x844`, `360x800`
  - Observed totals: **`overflowCount: 0`**, **`pageErrorsCount: 0`**
  - Screenshots inspected: `gov_1440.png`, `gov_390.png`
