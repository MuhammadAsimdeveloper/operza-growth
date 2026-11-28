# Staging Capacity & Limitations

- **Staging Sizing (`environments/staging/terraform.tfvars.example`):**
  - API: `1` ECS Fargate task (`0.5` vCPU / `1` GB RAM), `PG_MAX_POOL=25`.
  - Worker: `1` ECS Fargate task (`0.5` vCPU / `1` GB RAM), `WORKER_CONCURRENCY=4` (or `10` per `.env.staging.example`).
  - RDS: `db.t4g.small` Single-AZ (`20`–`100` GB gp3).
  - Redis: `cache.t4g.micro` Single-node.
- **Limitations:** Single-AZ RDS/Redis and single-task API/Worker provide functional staging verification only — **not** production high availability, zero-downtime failover, or high-concurrency load capacity.
