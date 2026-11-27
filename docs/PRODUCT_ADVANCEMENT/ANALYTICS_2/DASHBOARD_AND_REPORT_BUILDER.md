# Dashboard & Custom Report Builder Design

- **Allowlisted Query Engine:** `buildSafeReportQuery` restricts `dataSource`, `dimensions`, `measures`, and `filters` to explicit allowlists, enforces `actorPermissions`, injects `agency_id = $1 AND location_id = $2`, and caps `LIMIT <= 500` (zero arbitrary SQL).
- **Visibility Governance:** `analytics_saved_dashboards` and `analytics_saved_reports` enforce `visibility IN ('private', 'agency')` with `owner_user_id` filtering.
- **Safe Exports:** `redactExportRows` strips PII/secret fields and `formatSafeCsv` neutralizes spreadsheet formula injection (`=`, `+`, `-`, `@`).
