# Performance & Reliability Results

## 1. Local PostgreSQL Benchmark (`stage19_rc1_verify.mjs`)

- **Environment:** Windows host, Node.js v24.22.0, local `IsolatedTestPostgres` (PostgreSQL), non-superuser `operza_app` role under `FORCE ROW LEVEL SECURITY`.
- **Dataset:** 2 isolated agencies (`agA`, `agB`), 100 contacts in `location_records`, warm-up run + **20 measured requests** per workload.

| Workload | p50 (ms) | p95 (ms) | p99 (ms) | Errors |
| --- | --- | --- | --- | --- |
| CRM Contacts List (`TenantTx`, `LIMIT 50`) | `1.05` | `1.74` | `1.74` | `0` |
| Analytics Executive Overview (`TenantTx`, `getExecutiveOverview`) | `4.29` | `5.81` | `5.81` | `0` |
| Team & Locations List (`TenantTx`) | `0.56` | `0.80` | `0.80` | `0` |
| Workflow Execution History (`TenantTx`, `LIMIT 25`) | `0.73` | `1.47` | `1.47` | `0` |

*(Note: In `stage-18-hardening.test.mjs`, a separate cold-pool 20-run measurement of `getExecutiveOverview` recorded `p50=17.44ms`, `p95=23.62ms`.)*

## 2. Reliability & Concurrency Evidence

- **1,000-Job Chaos & Scale Test (`@operza/workflow-engine`):** `Completed=1000/1000`, `TimeoutsInjected=40`, `LeaseExpiries=40`, `DuplicatesPrevented=0`, `ElapsedMs=17` — zero lost jobs and zero duplicate side effects.
- **Multi-Process Appointment Booking (`@operza/api`):** Two independent API processes (ports `4301`, `4302`) sharing PostgreSQL enforce `409` on concurrent slot double-booking.
- **Worker & Outbox Limitations:** Local dev runs with in-memory queue/rate-limit fallbacks when `REDIS_URL` is unset. Multi-instance staging **must** run Redis + BullMQ (`DISTRIBUTED_RATE_LIMIT_STRICT=true`) and dedicated `npm run worker` processes.
- **Throughput Caveat:** Local single-machine benchmarks do not represent multi-tenant production throughput under network latency, large datasets (>100k rows), or concurrent connection pool saturation.
