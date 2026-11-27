# Semantic Layer Design

`METRIC_CATALOG_V2` centralizes metric definitions in `packages/platform-core/src/analytics-2-0.mjs` and exposes them via `GET /api/reports/v2/catalog`, ensuring Executive Overview, Custom Report Builder, Threshold Alerts, and UI widgets share one authoritative calculation contract.
