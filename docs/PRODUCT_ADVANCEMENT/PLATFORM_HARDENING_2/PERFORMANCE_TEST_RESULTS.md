# Performance Test Results — Stage 18

## 1. Controlled Local Benchmark Methodology

- **Environment:** Local Windows workstation, Node.js `v24.22.0`, isolated local `IsolatedTestPostgres` instance (`operza_app` role under `FORCE ROW LEVEL SECURITY` and `TenantTx`).
- **Dataset:** `2` agencies, `2` locations, `100` synthetic contact records in `location_records`.
- **Method:** `1` warm-up `TenantTx` call followed by `20` sequential `runInTenantTx(appPool, ctxA, tx => analyticsRepo.getExecutiveOverview(tx))` calls (each executing 10 tenant-scoped SQL aggregations inside `BEGIN ... SET LOCAL ... COMMIT`).
- **Observed Results (`packages/platform-core/test/stage-18-hardening.test.mjs`):**
  - **`p50`:** `3.77 ms`
  - **`p95`:** `4.79 ms`
  - **Errors:** `0`

## 2. Caveats

- These measurements reflect a single-machine local PostgreSQL instance with a small synthetic dataset and **do not** represent production SLAs, multi-AZ network latency, or high-concurrency throughput under load.
