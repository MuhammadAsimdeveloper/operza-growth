# Sites 2.0 — SEO & Immutable Publishing Design

- **Immutable Versioning (`site_versions` + `sites_2`):** `publishSite` validates every page schema, archives the previous `published` version, inserts a new immutable `site_versions` row, and updates `sites_2.published_version_id` atomically. `rollbackSite` restores any historical version without mutating past records.
- **SSR & SEO (`ssr-renderer.mjs`, `renderSafeSectionsHtml`):** Escapes all dynamic text, restricts CTA `href` protocols to `http(s):`, `/`, or `#`, emits canonical URLs and valid JSON-LD, and excludes draft/noindex pages from public sitemaps.
