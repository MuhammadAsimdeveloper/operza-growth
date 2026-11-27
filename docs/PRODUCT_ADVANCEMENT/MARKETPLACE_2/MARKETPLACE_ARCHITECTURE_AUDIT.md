# Marketplace Architecture Audit — Product Advancement Stage 5

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Baseline Commit:** `af07646`

## 1. Baseline Triage
Reproduced before Stage 5 edits:
- `apps/api/test/phase-2b-independent-verification.test.mjs` (`3.1 Concurrent verification`): 1 failure (`5 !== 9`, pre-existing).
- `apps/api/test/release-verification-gaps.test.mjs` (tests `3` & `4`): 2 failures (pre-existing).
- `packages/platform-core/test/provider-adapters.test.mjs` (`Stripe remains disabled`): 1 failure (`INVALID_CREDENTIAL_FORMAT !== PAYMENTS_DISABLED_PENDING_COMPLIANCE`, pre-existing).

## 2. Existing Phase 7 Marketplace Capabilities
- **Schema (`039_phase7_saas_marketplace_oauth_admin.sql`):** `marketplace_apps`, `marketplace_installations` (`FORCE RLS`), `oauth_apps`, `oauth_auth_codes`, `oauth_tokens`, `saas_subscriptions`, and `platform_admin_audit_log`.
- **Repository (`marketplace-repository.mjs`) & Routes (`phase7.mjs`):** Supports `submitApp`, `reviewApp`, `listPublishedApps`, `installApp` (validates `grantedScopes ⊆ requested_scopes` and approved status), `listInstallations`, and `uninstallApp`.
- **Platform Admin Separation:** `phase7.mjs` enforces `actor?.isPlatformAdmin === true` on `/api/platform-admin/*` and logs to `platform_admin_audit_log`.

## 3. Gaps Identified
| Area | Current State | Risk / Gap | Stage 5 Target |
| :--- | :--- | :--- | :--- |
| **App Types & Manifests** | Free-form `manifest jsonb` | No strict schema validation for app types, semver, compatibility, pricing minor-units, or unsafe URLs/code | `marketplace-2-0.mjs` strict manifest validator + semver compatibility + zero executable code |
| **Publisher Portal** | `publisher_id text` only | No `marketplace_publishers` table, publisher verification, or ownership separation | `marketplace_publishers` (`044_marketplace_2_0.sql`) + publisher-scoped CRUD |
| **Release & Update Safety** | Single `version` string on `marketplace_apps` | No `marketplace_app_releases` table; upgrades lack scope-escalation consent checks | `marketplace_app_releases` + upgrade scope-escalation check (`PERMISSION_UPGRADE_CONSENT_REQUIRED`) |
| **Reviews & Analytics** | None | No verified-installation-only reviews, moderation, or real usage metrics | `marketplace_app_reviews` + `marketplace_analytics_events` |
| **UI** | `AppsDirectory.tsx` lists internal routes; `Integrations.tsx` has provider cards | No dedicated Marketplace Catalog, My Applications, Developer Portal, or Platform Admin review UI | `MarketplaceHub2Panel.tsx` in `AppsDirectory.tsx` powered by TanStack Query |
