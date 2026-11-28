# Container & Worker Architecture

- **API Container (`apps/api/Dockerfile`):** `node:22-alpine`, `dumb-init`, `npm ci --omit=dev`, non-root `USER node`, `HEALTHCHECK` on `GET /health`, `CMD ["node", "apps/api/server.mjs"]`.
- **Worker Container (same image, overridden command):** `CMD ["node", "apps/api/worker.mjs"]` — runs `startDurableWorker` with `WORKER_DATABASE_URL` (`operza_worker`), `OPERZA_VAULT_KEY`, and `WORKFLOW_JOB_MODULE=packages/platform-core/src/trusted-handlers.mjs`.
- **Web Container (`apps/web/Dockerfile`):** Multi-stage `node:22-alpine` builder -> `nginx:1.27-alpine` (used for local Compose; AWS staging uses S3 + CloudFront directly).
- **Separation:** API handles HTTP/WebSockets and enqueues outbox events; Worker claims leases and executes durable handlers (`workflow.*`, `crm.lead.qualified`, `audit.event.record`, `zapier.webhook.deliver`) with `SIGTERM` graceful shutdown.
- **Local Limitation:** `docker` CLI is not installed on this Windows host, so container image builds (`docker build`) are verified via CI Gate 3 (`docker/build-push-action@v5`), not locally.
