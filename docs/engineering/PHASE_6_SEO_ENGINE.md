# Phase 6 — SEO Engine & Astro Marketing Site

**Astro Workspace:** `apps/marketing/` (`@operza/marketing`, static output to `apps/marketing/dist/`)
**Multi-Tenant SEO:** `packages/platform-core/src/sites/ssr-renderer.mjs`
**Audit Suite:** `scripts/seo-audit/run-seo-checks.mjs`

- **Astro Marketing Pages:** `/`, `/features`, `/integrations`, `/pricing`, `/contact`, `/sitemap.xml`, `/robots.txt`.
- **Multi-Tenant Controls:** `generateTenantSitemapXml()` excludes `draft` and `noIndex` pages; `generateTenantRobotsTxt()` emits per-domain `Sitemap:` directives; `renderPublishedSiteHtml()` enforces `noindex, nofollow` on previews and valid `canonical` URLs on published pages.
