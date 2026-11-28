# API & Worker Process Simulation Results

- **Container Runtime:** Not executed in Docker (`docker` absent on host); executed as isolated host processes against `IsolatedTestPostgres` in `NODE_ENV=staging`:
  - **API (`apps/api/server.mjs` as `operza_app`):** Booted cleanly without attempting runtime DDL, served `GET /health` (`200`), `GET /ready` (`200`, `dbEngine: "postgresql"`, `dbStatus: "connected"`), and shut down cleanly on `SIGTERM`.
  - **Worker (`apps/api/worker.mjs` as `operza_worker`):** Booted cleanly, registered all 7 durable handlers (`concurrency: 4`), and shut down cleanly on `SIGTERM`.
