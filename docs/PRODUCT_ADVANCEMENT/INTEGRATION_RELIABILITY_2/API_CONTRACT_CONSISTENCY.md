# API Contract Consistency

- Verified request/response schemas, `401`/`403`/`404`/`409` error contracts, minor-unit currency fields (`totalCents`, `amountCents`), ISO-8601 UTC timestamps, and server-side pagination (`limit`, `offset`, `total`).
- Fixed `apps/api/routes/analytics2.mjs` `!pgPool` fallback so `/api/reports/v2/overview`, `/dashboards`, and `/saved-reports` return consistent JSON structures in local zero-config mode instead of `503 PG_REQUIRED`.
- Fixed `EmptyState` (`icon?`) and `Card` (`style?`) TypeScript contracts so `@operza/web` `typecheck` passes with `0` errors across all modules.
