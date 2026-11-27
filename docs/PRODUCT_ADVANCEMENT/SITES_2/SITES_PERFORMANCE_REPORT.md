# Sites 2.0 — Performance & Caching Report

- **Host + Version Cache (`createPublicPageCache`):** Keys cached SSR HTML by verified hostname and `published_version_number`, invalidating on publish, rollback, or domain disconnect so draft content never leaks.
- **Frontend:** `SitesHub2Panel.tsx` is code-split inside the lazy `Websites` route chunk; `apps/marketing` Astro build generates static HTML with minimal client JS.
- **Scope Note:** Production CDN edge performance requires live AWS/CloudFront deployment evidence.
