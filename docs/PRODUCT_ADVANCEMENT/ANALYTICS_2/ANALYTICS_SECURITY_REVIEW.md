# Analytics 2.0 Security Review

- **Zero Arbitrary SQL:** `buildSafeReportQuery` rejects any non-allowlisted table, dimension, measure, or filter operator.
- **Tenant & User Privacy (`FORCE RLS`):** All 5 tables in `045_analytics_2_0.sql` enforce composite `(agency_id, location_id, id)` `FORCE ROW LEVEL SECURITY` under `operza_app`, and `private` dashboards/reports filter by `owner_user_id`.
- **Export Redaction:** `POST /api/reports/v2/export` redacts `email`, `phone`, `ssn`, `password`, `secret`, `token`, and `address` fields by default and escapes CSV formula prefixes.
