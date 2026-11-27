# Mobile & PWA 2.0 — Installation & Manifest

- **`apps/web/public/manifest.json`:** Declares `id: "/"`, `scope: "/"`, `start_url: "/"`, `display: "standalone"`, `theme_color: "#4f46e5"`, `background_color: "#ffffff"`, and 3 SVG icon entries (`favicon.svg`, `icon-192.svg` `192x192` `any maskable`, `icon-512.svg` `512x512` `any maskable`).
- **Browser Compatibility Note:** Chromium/Android standalone installation heuristics are satisfied by the manifest and service worker; iOS Safari Add-to-Home-Screen and non-Chromium desktop browsers vary in install prompt behavior.
