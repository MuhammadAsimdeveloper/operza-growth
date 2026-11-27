# Operza Growth — Sites & Funnels 2.0 Implementation Plan

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `f70f8a0`

1. **Database Migration (`packages/db/migrations/048_sites_2_0.sql`):**
   - `sites_2`, `site_pages_2`, `site_starter_templates`, `site_media_assets`, and `site_conversion_events` with composite `(agency_id, location_id, id)` PKs, `FORCE ROW LEVEL SECURITY`, and `operza_app` / `operza_worker` grants.
2. **Core Engine (`packages/platform-core/src/sites-2-0.mjs`):**
   - Versioned Page & Section Schema (`SCHEMA_VERSION = 2`) with 6 component categories (`layout`, `navigation`, `content`, `marketing`, `commerce`, `forms`), strict XSS/`<script>`/`javascript:`/`on*=` rejection, and safe SSR HTML rendering.
   - Starter Template Library (agency, SaaS, consultant, local business, appointment, lead-gen) with zero fake testimonials/logos.
   - Funnel Step Sequence validator, Media asset state machine (`uploaded`, `quarantined`, `scanned_clean`, `infected`, `published`), and Conversion Event deduplication builder.
3. **Repository & Modular API (`packages/db/lib/sites-2-repository.mjs`, `apps/api/routes/sites2.mjs`):**
   - `TenantTx`-scoped Sites/Pages CRUD, optimistic concurrency `savePageDraft` (`409 VERSION_CONFLICT`), atomic `publishSite` (integrating with `site_versions`), `rollbackSite`, media asset registration, and conversion event tracking, mounted in `apps/api/routes/funnels.mjs` under `/api/sites/v2/*`.
4. **Unified Visual Editor & Sites 2.0 UI (`apps/web/src/components/SitesHub2Panel.tsx`):**
   - Mounted in `apps/web/src/pages/Websites.tsx` with 3-pane Visual Editor 2.0 (Section Library + Canvas with Desktop/Tablet/Mobile preview + Property Inspector, Undo/Redo, Save Draft, Publish), Starter Templates, Media & Domains, and Conversion Analytics.
5. **Testing, Playwright Viewport Verification & Documentation:**
   - `packages/platform-core/test/sites-2-0.test.mjs`, full regression (`@operza/api`, `@operza/db`, `verify-ci-postgres.mjs`, `@operza/web` `typecheck` + `build`, `test-e2e.mjs`, `run-seo-checks.mjs`), Playwright desktop/mobile check on `/websites`, and all 10 docs in `docs/PRODUCT_ADVANCEMENT/SITES_2/`.
