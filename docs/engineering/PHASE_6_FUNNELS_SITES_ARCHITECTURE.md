# Phase 6 — Funnels & Sites V2 Architecture

**Repositories:** `packages/db/lib/funnels-repository.mjs`, `packages/db/lib/site-versions-repository.mjs`
**Renderer & Cache:** `packages/platform-core/src/sites/ssr-renderer.mjs`

- **Draft vs. Published Isolation:** `saveDraft()` creates `status = 'draft'` snapshots without altering the active `status = 'published'` version.
- **Publish & Rollback:** `publishVersion()` archives the previous `published` version and increments `version_number`; `rollbackToVersion()` publishes a new immutable version from a prior snapshot.
- **SSR & XSS Protection:** `renderPublishedSiteHtml()` escapes all CMS text, injects `<title>`, `<meta name="description">`, `<link rel="canonical">`, Open Graph tags, and `WebPage` / `FAQPage` JSON-LD.
- **Cache Invalidation:** `createPublicPageCache()` keys responses by `${host}:${siteId}:v${version}:${slug}` and invalidates on publish or domain disconnect.
