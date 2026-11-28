# Redis Staging Validation

- **Staging Config (`infra/terraform/modules/redis/main.tf` & `ecs/main.tf`):**
  - ElastiCache Redis 7.1 (`cache.t4g.micro`), `transit_encryption_enabled = true`, `at_rest_encryption_enabled = true`, private `isolated_db` subnets, SG restricted to `ecs_tasks`.
  - ECS API task sets `DISTRIBUTED_RATE_LIMIT_STRICT=true` so missing Redis fails closed rather than silently falling back to process-local rate limiting.
- **Local Verification Status:** `redis-server` and `redis-cli` are **MISSING** on this Windows host, so live Redis connectivity and multi-worker BullMQ failover were **not** executed locally (covered by CI Gate 3 with `redis:7-alpine`).
