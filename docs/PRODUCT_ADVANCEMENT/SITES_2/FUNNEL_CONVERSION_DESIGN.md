# Sites 2.0 — Funnel Conversion & Attribution Design

- **Funnel Sequence Validation (`validateFunnelSequence`):** Enforces non-empty steps, required `id`/`slug`/`kind`, and unique step slugs.
- **Conversion Event Deduplication (`site_conversion_events`):** Supports `page_view`, `landing_view`, `form_view`, `form_start`, `form_submit`, `booking_start`, `booking_complete`, `cta_click`, `step_progress`, and `conversion` with `UNIQUE (agency_id, location_id, dedup_key)` (`buildConversionDedupKey`).
- **Automation:** Connected funnels trigger Workflow Engine 2.0 rather than a parallel runtime.
