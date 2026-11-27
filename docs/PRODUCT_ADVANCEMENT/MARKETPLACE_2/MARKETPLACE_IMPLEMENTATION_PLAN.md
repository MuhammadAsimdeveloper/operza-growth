# Marketplace & Developer Ecosystem 2.0 — Implementation Plan

**Date:** 2026-11-27  
**Stage:** Product Advancement Stage 5

## 1. Implementation Phases
1. **Database Schema & `FORCE RLS` (`packages/db/migrations/044_marketplace_2_0.sql`):**
   - `marketplace_publishers`: Publisher profiles, verification status, terms acceptance, owner separation.
   - `marketplace_app_releases`: Semantic-versioned releases, compatibility range, release notes, manifest snapshot, security review status.
   - `marketplace_app_reviews`: Verified-installation-only ratings & written reviews, publisher reply, admin moderation state.
   - `marketplace_analytics_events`: Real listing views, install attempts, active installs, and errors.
   - Additive columns on `marketplace_apps` & `marketplace_installations` (`app_type`, `pricing_model`, `price_cents`, `currency`, `installed_version`, `paused_at`).
2. **Core Marketplace 2.0 Engine (`packages/platform-core/src/marketplace-2-0.mjs`):**
   - Strict manifest validation (app types, semver, HTTPS-safe URLs, minor-unit integer pricing, zero executable code).
   - App & installation lifecycle state machines.
   - Scope governance & upgrade consent enforcement (`requiresRenewedConsent`).
   - Verified review eligibility & anti-self-review checks.
3. **Repository & API (`packages/db/lib/marketplace-2-repository.mjs`, `apps/api/routes/marketplace2.mjs`):**
   - Publisher isolation, platform-admin review/suspend/moderate governance with immutable audit log, `TenantTx` installation/upgrade/pause/uninstall/review flows, and publisher-scoped analytics.
4. **Frontend Marketplace 2.0 (`apps/web/src/components/MarketplaceHub2Panel.tsx` in `AppsDirectory.tsx`):**
   - Catalog, My Applications, Developer Portal, and Platform Admin tabs powered by TanStack Query.
5. **Verification & Documentation:**
   - Unit, security, lifecycle, and real PostgreSQL `FORCE RLS` tests + 10 `MARKETPLACE_2` docs.
