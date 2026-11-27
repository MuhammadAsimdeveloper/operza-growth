# Sites 2.0 — Page Schema & Component Library

- **Schema Version (`PAGE_SCHEMA_VERSION = 2`):** Validates `slug` (must start with `/`, no `..`), `title`, `sections` (max `100`), `id`/`type`, and `seoMeta`.
- **6 Component Categories (`SITE_COMPONENT_LIBRARY`):** `layout`, `navigation`, `content`, `marketing`, `commerce`, `forms`.
- **Security:** `validatePageSchema` recursively rejects `<script>`, `<iframe>`, `on*=` event handlers, `javascript:` URLs, and `__proto__`/`constructor`/`prototype` keys.
- **Starter Templates (`STARTER_TEMPLATES`):** Agency Growth, SaaS Product Launch, and Appointment & Consultation starter schemas using clearly labeled editable placeholders with zero fake testimonials or logos.
