# Analytics Data Consistency

- `aggregateCanonicalRevenueByCurrency` (`cross-platform-events.mjs`) sums only `paid` invoices per currency (`USD`, `EUR`, etc.) and subtracts only `completed` refunds, preventing unpaid drafts or cross-currency sums from inflating revenue.
- `apps/api/routes/analytics2.mjs` now computes real local-state overview metrics with `freshnessAt` timestamp when `pgPool` is absent, instead of failing with `503`.
