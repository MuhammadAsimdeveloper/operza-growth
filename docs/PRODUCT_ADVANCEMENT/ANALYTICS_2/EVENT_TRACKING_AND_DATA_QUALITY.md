# Event Tracking & Data Quality

**Table:** `analytics_events` (`045_analytics_2_0.sql`)

Enforces `UNIQUE (agency_id, location_id, source_module, deduplication_key)` so duplicate webhook/worker retries cannot inflate business event counts. Authoritative `agency_id` and `location_id` come strictly from `TenantTx`.
