# Redis & Distributed Rate-Limit Results

- **Live Redis Integration:** **NOT EXECUTED** (`redis-server` and `redis-cli` are not installed on this Windows host; tested in CI Gate 3 with `redis:7-alpine`).
- **Fail-Closed Contract Verified (`stage22_verify.mjs`):**
  - Instantiated `createAuthRateLimiter({ strictDistributed: true })` without a Redis backend and called `check('127.0.0.1', 'login')`.
  - **Result:** Threw `RATE_LIMIT_BACKEND_UNAVAILABLE` (`Distributed Redis rate limiter not configured`), proving `DISTRIBUTED_RATE_LIMIT_STRICT=true` does **not** silently fall back to process-local memory.
