# Staging Load & Chaos Results (Phase 8.2)

- **Reproducible Staging Stack Prepared:** [docker-compose.staging.yml](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/docker-compose.staging.yml) (`pgvector/pgvector:pg16`, `redis:7-alpine`, `clamav/clamav:stable`, `migrate`, `api`, `worker-1`, `worker-2`) + `.env.staging.example`.
- **Multi-Worker Redis Load & Chaos Execution Status:** **BLOCKED locally** (Docker Engine and Redis are not installed on this Windows host).
- **Commands for Staging Execution:**
  1. `docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build`
  2. `node scripts/load-chaos-real.mjs`
- **Prior Local Baseline (Preserved Separately):** Local single-API + PostgreSQL 18 burst (`scripts/load-chaos-real.mjs`) achieved `3,355.7 RPS` at `100` concurrency (`p99 = 57.21ms`, `0` 5xx).
