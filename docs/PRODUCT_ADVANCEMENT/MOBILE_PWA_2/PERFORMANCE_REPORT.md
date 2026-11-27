# Mobile & PWA 2.0 — Performance Report

- **Code Splitting:** Every workspace route uses `React.lazy` + `Suspense`, keeping initial entry JS (`index-*.js`) around `~286 kB` (`~87 kB` gzip) while heavy modules (`Workflows` `@xyflow/react`, `Websites`, `Academy`) load on demand.
- **Static Asset Caching:** `sw.js` caches immutable `/assets/*` bundles locally on `GET` (`response.type === 'basic'`).
- **Scope Note:** Local Playwright runs confirm zero layout overflow and fast local route transitions; production Lighthouse scores on live mobile 3G/4G networks require staging CDN deployment.
