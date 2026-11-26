# Real Stack Load & Chaos Test Report

**Harness:** `node scripts/load-chaos-real.mjs` (Real `apps/api/server.mjs` process + Real PostgreSQL 18 with all 39 migrations).
**Infrastructure Limitation:** `redis-server` and `docker` are not installed on this Windows host; multi-worker Redis queue scaling under 10x load is **BLOCKED** pending staging Redis infrastructure.

## Measured Real API + PostgreSQL Burst Results
| Load Level | Concurrency | Total Reqs | RPS | p50 (ms) | p95 (ms) | p99 (ms) | 5xx Errors |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **1x (Baseline)** | 10 | 50 | `1087.0` | `6.24` | `20.40` | `20.79` | `0` |
| **2x** | 20 | 100 | `2083.3` | `9.36` | `15.42` | `15.81` | `0` |
| **5x** | 50 | 250 | `2577.3` | `13.56` | `36.42` | `36.89` | `0` |
| **10x** | 100 | 500 | `3355.7` | `21.76` | `52.50` | `57.21` | `0` |

**Concurrency & Resilience Checks:**
- PostgreSQL GiST overlapping-slot concurrency (`20` concurrent requests -> `1` winner) and durable workflow lease recovery/fencing remain verified in `scripts/verify-ci-postgres.mjs` (`130/130` PASS).
