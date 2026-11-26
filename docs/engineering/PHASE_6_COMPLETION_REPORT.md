# Phase 6 Completion Report — Funnels/Sites V2, Calendar V2, Astro Marketing, SEO & Custom Domains

**Date:** 2026-11-26
**Branch:** `feat/operza-agency-launch-readiness`
**Baseline Commit:** `be39d1d`

## Summary of Deliverables
1. **Migration 038 (`packages/db/migrations/038_phase6_sites_domains_ssl.sql`):** `site_versions`, `custom_domains`, `ssl_certificates`, and `calendar_availability_rules` with `FORCE ROW LEVEL SECURITY` and global active-hostname uniqueness.
2. **Custom Domains & SSL (`packages/platform-core/src/domains/custom-domains.mjs`, `packages/db/lib/custom-domains-repository.mjs`, `apps/api/routes/domains.mjs`):** IDNA normalization, reserved-domain blocking, DNS TXT challenge verification, ACME/TLS adapter requiring HTTPS verification before `active`, and `resolvePublicHost()` host-spoofing protection.
3. **Funnels/Sites V2 & Multi-Tenant SEO (`packages/db/lib/site-versions-repository.mjs`, `packages/platform-core/src/sites/ssr-renderer.mjs`):** Immutable draft/published snapshots, rollback, XSS-escaped SSR HTML, canonical URLs, JSON-LD, tenant `sitemap.xml`/`robots.txt`, and host+version cache invalidation.
4. **Calendar V2 (`packages/platform-core/src/scheduling/availability-v2.mjs`):** IANA timezone & DST slot computation with buffers, min-notice, maxFutureDays, daily limits, and time-off blocks.
5. **Astro Marketing Site (`apps/marketing/`):** Static Astro build producing `/`, `/features`, `/integrations`, `/pricing`, `/contact`, `/sitemap.xml`, and `/robots.txt`.
