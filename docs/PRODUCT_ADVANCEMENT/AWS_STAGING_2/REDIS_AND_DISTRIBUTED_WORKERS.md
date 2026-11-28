# Redis & Distributed Workers

- **Staging Config:** ElastiCache Redis 7.1 (`rediss://...` TLS in transit, at-rest KMS encryption, private `isolated_db` subnets).
- **Fail-Closed Rate Limiting:** Staging ECS task definition sets `DISTRIBUTED_RATE_LIMIT_STRICT=true` so the API never silently falls back to an in-memory rate limiter across multiple tasks.
- **Worker Concurrency & Leases:** `apps/api/worker.mjs` uses PostgreSQL lease fencing (`WORKER_CONCURRENCY=4` default) and `OPERZA_VAULT_KEY` for encrypted secret resolution.
- **Verification Status:** Local `worker.mjs` startup and PostgreSQL handler registration verified (`stage20_local_sim.mjs`). Multi-worker distributed Redis/BullMQ failover remains **unverified** on this local host (no local Redis server running; covered in CI Gate 3 with `redis:7-alpine`).
