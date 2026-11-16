# Operza Growth — Production Deployment Runbook

## 1. Prerequisites & Infrastructure Requirements

Before deploying Operza to staging or production, ensure the following infrastructure is provisioned:

1. **Operating System**: Linux (Ubuntu 22.04 LTS / Debian 12 recommended) or Windows Server with Docker Engine 24+.
2. **Container Runtime**: Docker Engine with Docker Compose v2.
3. **Database**: PostgreSQL 16 (or PostgreSQL 18) with `btree_gist` extension enabled.
4. **Queue/Cache**: Redis 7.x with password authentication and `appendonly yes`.
5. **Compute**: Minimum 2 vCPUs, 4GB RAM (8GB recommended for agency production scale).
6. **Network & DNS**: Fully qualified domain name pointing to reverse proxy (Nginx / Caddy / Cloudflare).

---

## 2. Secrets & Environment Configuration

Create `.env` in the project root based on `.env.example` or `.env.staging.example`.

### Mandatory Production Variables:
```ini
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
PUBLIC_BASE_URL=https://api.operza.io
APP_BASE_URL=https://app.operza.io

# Generate with: openssl rand -hex 32 (MUST BE >= 32 characters)
SESSION_SECRET=<64_character_hex_string>
OPERZA_VAULT_KEY=<64_character_hex_string>
OPERZA_ADMIN_KEY=<64_character_hex_string>

# Unprivileged App Database Connection (RLS enforced)
DATABASE_URL=postgresql://operza_app:<app_password>@postgres:5432/operza_db
DATABASE_SSL=false

# Privileged Migrator Connection (Migrations only)
MIGRATION_DATABASE_URL=postgresql://operza_migrator:<migrator_password>@postgres:5432/operza_db

# Dedicated Background Worker Connection
WORKER_DATABASE_URL=postgresql://operza_worker:<worker_password>@postgres:5432/operza_db
PLATFORM_DB_ENABLED=true

# Distributed Queue
REDIS_URL=redis://:<redis_password>@redis:6379
```

---

## 3. Database Bootstrap & Role Provisioning

Execute `packages/db/scripts/bootstrap-roles.sql` as a PostgreSQL superuser to configure the three least-privilege roles:

```bash
psql -U postgres -d operza_db -f packages/db/scripts/bootstrap-roles.sql
```

This creates:
- `operza_migrator`: Table owner, used only by migration scripts.
- `operza_app`: Unprivileged runtime role with `NOBYPASSRLS` and `NOSUPERUSER`.
- `operza_worker`: Unprivileged worker role for queue and outbox operations.

---

## 4. Applying Migrations

Run database migrations using the dedicated npm workspace command:

```bash
npm --workspace=@operza/db run db:migrate
```

Verify that all 18 migrations (001–018) report `[SUCCESS] Migration applied`.

---

## 5. Starting the Production Stack via Docker Compose

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The stack initializes the following services:
- `operza-prod-postgres`: PostgreSQL 16 database.
- `operza-prod-redis`: Redis 7 distributed cache and queue.
- `operza-prod-migrate`: One-shot migration execution.
- `operza-prod-worker`: Durable background outbox and queue processor.
- `operza-prod-api`: API server and workflow execution engine.
- `operza-prod-web`: Nginx reverse proxy serving optimized React 19 frontend.

---

## 6. Health & Readiness Verification

Run curl commands to verify service health:

```bash
# 1. Primary API Health Probe
curl -f http://localhost:4000/health
# Response: {"name":"Operza Unified API","status":"healthy",...}

# 2. Production Readiness Probe (Checks database connection and registered tables)
curl -f http://localhost:4000/ready
# Response: {"ready":true,"status":"ready","dbEngine":"postgresql","dbStatus":"connected",...}

# 3. Observability Metrics
curl -f http://localhost:4000/metrics
```

---

## 7. Rollback & Disaster Recovery Procedures

1. **Database Rollback**: Migrations are additive and non-destructive. If a deployment fails, revert container image tags and restore from PostgreSQL continuous WAL archiving or daily automated snapshot.
2. **Graceful Worker Shutdown**: The durable worker listens for `SIGTERM` and `SIGINT`, finishing active in-flight jobs within a 15-second grace window before releasing leases.
3. **Emergency Secret Rotation**: To rotate `OPERZA_VAULT_KEY`, re-encrypt stored secrets in `provider_secrets` using the transition script before swapping the environment variable.
