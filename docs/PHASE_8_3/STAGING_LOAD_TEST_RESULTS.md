# Phase 8.3 — Real Staging Load & Chaos Test Results

- **Staging Stack Status:** **BLOCKED locally** (Docker Engine and Redis are not installed on this Windows host; no live staging infrastructure deployed without owner cloud approval).
- **Pinned Staging Stack:** `docker-compose.staging.yml` (`pgvector/pgvector:0.8.0-pg16`, `redis:7.4.2-alpine`, `clamav/clamav:1.4`, `api`, `worker-1`, `worker-2`).
- **Local Single-Node Baseline (Preserved Separately):** `scripts/load-chaos-real.mjs` measured `3,355.7 RPS` at `100` concurrency (`p99 = 57.21ms`, `0` 5xx) against local PostgreSQL 18.
