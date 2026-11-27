# Operza Growth — Website, Landing Page & Funnel Builder 2.0 Architecture Audit

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `f70f8a0`

---

## 1. Existing Architecture Assessment

### 1.1 Publishing, Versioning & SSR (`038_phase6_sites_domains_ssl.sql`, `site-versions-repository.mjs`, `ssr-renderer.mjs`)
- **Implemented & Verified:** Immutable `site_versions` with `saveDraft`, `publishVersion`, `getPublishedVersion`, `rollbackToVersion`; `ssr-renderer.mjs` with `escapeHtml`, `buildCanonicalUrl`, `WebPage`/`FAQPage` JSON-LD, `sitemap.xml`, `robots.txt`, and `createPublicPageCache` keyed by verified host + version.
- **Gaps:**
  - `Websites.tsx` & `VisualPageBuilder.tsx` still rely heavily on `useStore()` / `localStorage` rather than schema-validated PostgreSQL `sites_2` and `site_pages_2` with optimistic concurrency (`version_lock`).
  - Component library needs a formal versioned schema validator rejecting unsafe raw HTML/JS (`<script>`, `on*=`, `javascript:` URLs) before draft save or publish.

### 1.2 Custom Domains & SSL (`custom-domains-repository.mjs`, `domains.mjs`)
- **Implemented & Verified:** Global `UNIQUE (lower(hostname)) WHERE status <> 'disconnected'`, DNS TXT ownership challenge, SSL certificate lifecycle states (`provisioning_requested` -> `active`), and host cache invalidation.
- **Gaps:** Live DNS/ACME remains an external staging gate.

### 1.3 Funnels, Forms, Media & Analytics (`funnels-repository.mjs`, `forms-repository.mjs`, `upload-scanner.mjs`, `analytics-2-0.mjs`)
- **Gaps:** Need explicit conversion event deduplication (`site_conversion_events`), media scan-state tracking (`uploaded`, `quarantined`, `scanned_clean`, `published` without faking ClamAV), and unified Sites 2.0 + Visual Editor 2.0 API/UI integration.
