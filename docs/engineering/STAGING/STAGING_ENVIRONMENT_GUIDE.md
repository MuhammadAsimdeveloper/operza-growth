# Operza Staging Readiness — Staging Environment Setup Guide

**Document ID:** `DOC-STG-ENV-005`  
**Classification:** `INTERNAL ENGINEERING SPECIFICATION`  
**Target Environment:** Isolated Non-Production Staging Infrastructure  
**Companion File:** `.env.staging.example`  
**Date:** March 2026 (Operza Release Candidate)

---

## 1. Purpose & Guiding Principles

This guide details the end-to-end operational procedure for provisioning, configuring, and verifying Operza in a dedicated, isolated staging environment.

### Staging Invariants
1. **Zero Production Bleed:** Staging databases, queues, and credentials must have no connection or shared permissions with production.
2. **Fail-Closed Relational Persistence:** In staging (`NODE_ENV=staging`), the application strictly refuses startup if PostgreSQL is unconfigured or unreachable. Silent fallback to JSON files (`store.json`) is permanently disabled.
3. **No Paid Live Provider Invocations:** All third-party providers (Stripe, Twilio, Resend, SendGrid, Meta WhatsApp) must use official test-mode API keys and sandboxes.
4. **Independent Service Roles:** Schema migrations must execute under `operza_migrator`. The application runtime must connect under `operza_app` with forced Row-Level Security.

---

## 2. Infrastructure Architecture & Topology

```mermaid
graph TD
    User([Staging QA / Automated Runners]) --> Ingress[Cloudflare / AWS ALB: staging.operza.internal]
    
    subgraph Staging Private Subnet
        Ingress --> Web[operza-web: Nginx Container :80]
        Web -->|Proxy /api and /ws| API[operza-api: Node 22 Container :4000]
        
        API --> PG[(AWS RDS PostgreSQL 16: operza_staging)]
        API --> Redis[(AWS ElastiCache Redis 7: operza-staging-redis)]
        
        Worker[operza-worker: Node 22 Container] --> PG
        Worker --> Redis
    end
    
    subgraph External Sandboxes
        API -.-> Stripe[Stripe Test Mode sk_test_...]
        API -.-> Twilio[Twilio Test Credentials]
        API -.-> Resend[Resend Test Sandbox]
    end
```

---

## 3. Step-by-Step Provisioning Procedure

### Step 1: Database Role Bootstrapping
Connect to the staging PostgreSQL instance as the database administrator (`postgres` or cloud master user) and execute `packages/db/scripts/bootstrap-roles.sql`:

```sql
-- 1. Create dedicated isolated database
CREATE DATABASE operza_staging;
\c operza_staging;

-- 2. Create unprivileged app role (Enforces RLS)
CREATE ROLE operza_app WITH LOGIN PASSWORD 'staging_app_secure_password' NOSUPERUSER NOBYPASSRLS;

-- 3. Create schema migration owner role
CREATE ROLE operza_migrator WITH LOGIN PASSWORD 'staging_migrator_secure_password' CREATEROLE;

-- 4. Create background queue worker role
CREATE ROLE operza_worker WITH LOGIN PASSWORD 'staging_worker_secure_password' NOSUPERUSER NOBYPASSRLS;

-- 5. Grant base permissions
GRANT CONNECT ON DATABASE operza_staging TO operza_app, operza_migrator, operza_worker;
GRANT ALL ON SCHEMA public TO operza_migrator;
GRANT USAGE ON SCHEMA public TO operza_app, operza_worker;
```

---

### Step 2: Schema Migrations (001–014)
From the deployment runner, run the automated migration command using the privileged `operza_migrator` connection:

```bash
export MIGRATION_DATABASE_URL="postgresql://operza_migrator:staging_migrator_secure_password@staging-db.operza.internal:5432/operza_staging"
npm run db:migrate
```

**Verification:** Confirm all 14 migrations are recorded:
```sql
SELECT name, applied_at FROM schema_migrations ORDER BY name ASC;
```

---

### Step 3: Environment Configuration
Copy `.env.staging.example` to `.env.staging` and verify mandatory variables:

```bash
cp .env.staging.example .env.staging
```

Ensure the following critical values are populated:
- `NODE_ENV=staging`
- `DATABASE_URL=postgresql://operza_app:staging_app_secure_password@staging-db.operza.internal:5432/operza_staging`
- `REDIS_URL=rediss://staging-redis.operza.internal:6379`
- `ALLOW_IN_MEMORY_QUEUE=false`
- `SESSION_SECRET` (minimum 32-character high-entropy secret)

---

### Step 4: API Service Deployment & Fail-Closed Probe
Start the API service container:
```bash
docker run -d \
  --name operza-staging-api \
  --env-file .env.staging \
  -p 4000:4000 \
  operza-api:rc-candidate
```

**Fail-Closed Verification Test:**
If `DATABASE_URL` is omitted or invalid, the container log will output:
```
[OPERZA-DB] FATAL: Running in staging mode requires DATABASE_URL to be set. Silent fallback to store.json is strictly forbidden.
```
and terminate with non-zero exit code.

---

### Step 5: Background Worker Deployment
Start the independent background worker container:
```bash
docker run -d \
  --name operza-staging-worker \
  --env-file .env.staging \
  -e WORKER_DATABASE_URL="postgresql://operza_worker:staging_worker_secure_password@staging-db.operza.internal:5432/operza_staging" \
  operza-api:rc-candidate node apps/api/worker.mjs
```

---

### Step 6: Frontend Client Deployment
Build and deploy the web container:
```bash
docker run -d \
  --name operza-staging-web \
  -p 80:80 \
  operza-web:rc-candidate
```

---

## 4. Staging Verification Smoke Tests

Once containers are active, execute the following smoke tests against the staging ingress:

```bash
# 1. API Health Check
curl -I https://staging-api.operza.internal/health
# Expected: HTTP/1.1 200 OK {"status":"healthy"}

# 2. Database Connectivity
curl -s https://staging-api.operza.internal/health | grep '"healthy"'

# 3. Web Client Asset Delivery
curl -I https://staging.operza.internal/
# Expected: HTTP/1.1 200 OK with Content-Type: text/html

# 4. WebSocket Handshake
curl -I -N -H "Connection: Upgrade" -H "Upgrade: websocket" https://staging-api.operza.internal/ws
# Expected: HTTP/1.1 101 Switching Protocols
```

---

## 5. Rollback & Teardown Protocol

If staging verification fails or a regression is detected:
1. **Container Drain:** Issue `docker stop operza-staging-api operza-staging-worker` (allows 30s `dumb-init` lease drain).
2. **Database Snapshot:** In AWS RDS, trigger an automated snapshot prior to any remediation.
3. **Rollback Container Version:** Re-deploy the previous green container tag.
