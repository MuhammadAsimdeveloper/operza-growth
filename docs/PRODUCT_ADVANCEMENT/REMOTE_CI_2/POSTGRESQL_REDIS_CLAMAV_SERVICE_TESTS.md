# PostgreSQL, Redis & ClamAV Service Tests (Gates E & F)

- **PostgreSQL (`postgres:16.4-alpine`):** Runs `migrate.mjs` (`001`–`054` as `operza_migrator`) and `stage-18-hardening.test.mjs` (`100% FORCE RLS`).
- **Redis (`redis:7.4.2-alpine`):** Boots `apps/api/server.mjs` with `NODE_ENV=staging`, `REDIS_URL=redis://127.0.0.1:6379`, and `DISTRIBUTED_RATE_LIMIT_STRICT=true`.
- **ClamAV (`clamav/clamav:1.4`):** Starts isolated container, waits for `clamdscan --ping 1`, and asserts EICAR test file detection (non-zero exit = detected) before removing container.
