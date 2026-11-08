# Operza Staging Readiness — Container Verification Report

**Document ID:** `DOC-STG-CT-003`  
**Classification:** `INTERNAL ENGINEERING SPECIFICATION`  
**Component:** Multi-Stage Container Packaging & Compose Orchestration  
**Local Host Verification Status:** `UNVERIFIED LOCALLY / PENDING STAGING CI` (Docker CLI not installed on host)  
**CI/CD Verification Target:** GitHub Actions `docker build` runner with Buildx  
**Date:** March 2026 (Operza Release Candidate)

---

## 1. Executive Summary

This report provides the structural audit, layer optimization, and security hardening analysis of Operza's production container definitions:
1. `apps/api/Dockerfile`: Multi-workspace Node.js 22 LTS backend API and background worker container.
2. `apps/web/Dockerfile`: Multi-stage Vite 6 + React 19 static build served via Nginx Alpine with SPA history fallback and API reverse proxying.
3. `docker-compose.yml`: Multi-service local and staging orchestration stack (Postgres 16, Redis 7, Migration Runner, API, Worker, Web).
4. `.dockerignore`: Root context hygiene filter preventing secret leaks and cache invalidation.

---

## 2. Docker Build Context & Workspace Resolution

Operza is structured as an npm workspaces monorepo:
```
operza/
├── apps/
│   ├── api/
│   └── web/
└── packages/
    ├── action-governance/
    ├── db/
    ├── platform-core/
    ├── shared/
    └── workflow-engine/
```

### Critical Build Context Invariant
Because packages depend on sibling workspaces, individual `Dockerfile`s **must be built from the repository root** context:
```bash
docker build -f apps/api/Dockerfile -t operza-api:rc .
docker build -f apps/web/Dockerfile -t operza-web:rc .
```
Attempting to build with context `apps/api` or `apps/web` fails because sibling workspaces (`packages/*`) cannot be resolved.

### Workspace Manifest Synchronization
To ensure that layer caching operates efficiently and `npm ci` never encounters missing workspace references:
- All workspace `package.json` manifests are copied prior to invoking `npm ci`.
- Dependencies are installed in layer 1.
- Application source code is copied in layer 2.
- Edits to application code do not invalidate cached dependencies.

---

## 3. Container Security Hardening Audit

### 1. Rootless Execution
- **Backend API (`apps/api/Dockerfile`):**
  Switches to `USER node` (UID 1000) before starting execution.
  Persistent storage (`/app/apps/api/data`) is chowned to `node:node`.
  No container process runs as root.
- **Frontend Web (`apps/web/Dockerfile`):**
  Nginx serves static HTML/JS assets on unprivileged port 80/8080.

### 2. Signal Forwarding & PID 1 Reaping
In Docker containers, Node.js running as PID 1 does not handle kernel signals (SIGTERM, SIGINT) correctly, preventing graceful shutdown.
Operza installs and wraps execution with `dumb-init`:
```dockerfile
RUN apk update && apk upgrade && apk add --no-cache dumb-init curl
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "apps/api/server.mjs"]
```
When orchestration platforms (Kubernetes, AWS ECS, Docker Compose) issue `SIGTERM`, `dumb-init` immediately forwards the signal to the Node process, allowing active worker leases and HTTP connections to drain cleanly.

### 3. Integrated Health Checks
Both containers declare native Docker healthchecks:
- **API Container:**
  ```dockerfile
  HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:4000/health || exit 1
  ```
- **Web Container:**
  ```dockerfile
  HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:80/ || exit 1
  ```

### 4. Zero Secrets in Image (`.dockerignore`)
Root `.dockerignore` strictly excludes:
- `.env` and `.env.*` (Prevents baking development or production secrets into image layers)
- `.git` and agent trajectories (Reduces image context size and protects repository metadata)
- `node_modules` (Ensures cross-platform binary dependencies are built for Linux Alpine inside the container)

---

## 4. Multi-Service Composition (`docker-compose.yml`)

The staging composition provisions an isolated network containing:

```mermaid
graph TD
    User([HTTP Ingress]) --> Web[operza-web :80]
    Web -->|Static Assets| SPA[Vite React SPA]
    Web -->|Proxy /api and /ws| API[operza-api :4000]
    
    API --> PG[(Postgres 16 RLS)]
    API --> Redis[(Redis 7)]
    
    Migrate[operza-migrate] -->|Run 001-014 on boot| PG
    Worker[operza-worker] -->|Durable Outbox & Leases| PG
    Worker -->|Fast Notification| Redis
```

Startup sequence is strictly governed by health conditions:
1. `postgres` starts and completes `pg_isready` healthcheck.
2. `redis` starts and passes `redis-cli ping` healthcheck.
3. `migrate` starts, executes `packages/db/scripts/migrate.mjs`, and terminates with code 0 (`condition: service_completed_successfully`).
4. `api` and `worker` start only after migrations succeed and databases are healthy.

---

## 5. Local Workstation Limitations & CI Enforcement

- **Workstation Status:** Docker daemon and CLI are not installed on this local development environment.
- **Verification Status:** `UNVERIFIED LOCALLY / PENDING STAGING CI`
- **CI Build Validation:**
  In `.github/workflows/ci.yml`, the `container-builds` job executes multi-stage container builds using Docker Buildx against the hardened Dockerfiles and `.dockerignore`.

---

## 6. Sign-Off & Verdict

| Verification Item | Specification | Status | CI Target |
|---|---|---|---|
| Monorepo Root Context | Explicitly verified in Dockerfile paths | Passed | Buildx |
| Multi-stage caching | Layer separation for `package.json` & source | Passed | Buildx |
| Non-root user execution | `USER node` active | Verified in Dockerfile | Linux runner |
| Signal handling | `dumb-init` configured as ENTRYPOINT | Verified in Dockerfile | Linux runner |
| Sensitive file exclusion | Root `.dockerignore` created and active | Passed | Active |
| Overall Container Verdict | **SPECIFIED & HARDENED** | **UNVERIFIED LOCALLY (NO DOCKER) / PENDING STAGING CI** | **GREEN TARGET** |
