# Analytics 2.0 Performance Report

- **Direct SQL Aggregations:** `getExecutiveOverview` aggregates counts and sums in PostgreSQL inside `TenantTx` without loading raw rows into Node.js memory.
- **Bounded Queries:** Custom reports cap `LIMIT <= 500` and require allowlisted indexed columns (`agency_id, location_id`).
- **Indexing:** `analytics_events_type_time_idx` on `(agency_id, location_id, event_type, occurred_at DESC)` and `UNIQUE (agency_id, location_id, source_module, deduplication_key)` support fast deduplication and time-series filtering.
