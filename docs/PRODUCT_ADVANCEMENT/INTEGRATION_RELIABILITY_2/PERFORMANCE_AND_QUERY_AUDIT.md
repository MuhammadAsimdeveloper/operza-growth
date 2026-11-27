# Performance & Query Audit

- All list endpoints (`support/v2/conversations`, `workflows/v2/runs`, `workflows/v2/dead-letters`, `Customer 360` sub-queries) enforce server-side `LIMIT` / `OFFSET` bounds (`1..100` / `10`).
- Composite tenant indexes on `(agency_id, location_id, ...)` added in Migrations `050` and `051` support inbox, ticket, and execution operations queries without full-table scans.
- Note: Local synthetic runs do not establish production multi-tenant throughput benchmarks.
