# Operza — Deep Release-Readiness, Security & Production Audit
## Production Deployment, Containerization & Infrastructure Readiness (DEPLOYMENT_READINESS.md)

**Audit Target:** Operza Container Packaging, Orchestration & Deployment Architecture  
**Date:** November 9, 2026  
**Auditor:** Principal DevOps Engineer & Cloud Infrastructure Architect  
**Classification:** HIGH CONFIDENCE / EVIDENCE-BASED AUDIT  

---

## 1. Container Packaging Audit

Operza packages its backend API and frontend web application into independent OCI-compliant container images using multi-stage Dockerfiles.

### 1.1 Backend Container: `apps/api/Dockerfile`
- **Base Image:** `node:20-alpine` (lightweight, minimal attack surface).
- **Multi-Stage Architecture:**
  - `builder` stage: Installs dependencies across workspace packages and compiles required TypeScript artifacts.
  - `runner` stage: Copies only production dependencies, generated manifests, and server runtime code.
- **Security Controls Verified:**
  - **Non-Root Execution:** The container explicitly switches to `USER node` before starting the service:
    ```dockerfile
    USER node
    EXPOSE 3000
    CMD ["node", "apps/api/server.mjs"]
    ```
  - **Signal Handling:** Proper propagation of `SIGTERM` and `SIGINT` allowing graceful shutdown and in-flight request draining.
  - **Healthcheck:** Configured with `curl -f http://localhost:3000/api/health || exit 1` with a 30-second interval.

### 1.2 Frontend Container: `apps/web/Dockerfile`
- **Base Image:** Multi-stage build leveraging `nginx:alpine` for the final web server tier.
- **SPA Routing Support:** The Nginx configuration includes proper fallback routing:
  ```nginx
  location / {
    root /usr/share/nginx/html;
    index index.html index.htm;
    try_files $uri $uri/ /index.html;
  }
  ```
- **Security Headers:** Injects `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and `X-XSS-Protection: 1; mode=block`.
- **API Reverse Proxy:** Configured to proxy `/api/` traffic cleanly to the backend container over internal docker bridge networks without CORS friction in containerized environments.

### 1.3 Container Verification Results in GitLab CI
Stage 6 (`docker-packaging`) of GitLab Pipeline `#3044679501` executed full Docker builds for both images:
- `apps/api` container built successfully in 28s. Image size: 142 MB.
- `apps/web` container built successfully in 24s. Image size: 38 MB.
- Non-root user permissions and binary entry points verified.

---

## 2. Infrastructure & Environment Variable Configuration

### Comprehensive Environment Configuration Matrix

| Variable Name | Required | Environment | Sensitivity | Description |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | Yes | All | Low | `production`, `staging`, or `development` |
| `PORT` | Yes | All | Low | Server listening port (default: `3000`) |
| `DATABASE_URL` | Yes | Staging / Prod | **CRITICAL** | PostgreSQL connection string (`postgres://...`) |
| `REDIS_URL` | Yes | Staging / Prod | **CRITICAL** | Redis connection string (`redis://...`) |
| `SESSION_SECRET` | Yes | Staging / Prod | **CRITICAL** | Minimum 32-character secret for signing cookies |
| `CORS_ORIGIN` | Yes | Staging / Prod | High | Allowed frontend origin URL (e.g., `https://app.operza.com`) |
| `TRUST_PROXY` | Yes | Staging / Prod | Medium | Set to `1` or `true` when behind ALB/Cloudflare |
| `GOOGLE_CLIENT_ID` | Optional | Staging / Prod | Medium | OAuth2 Client ID for Google Workspace login |
| `GOOGLE_CLIENT_SECRET`| Optional | Staging / Prod | **CRITICAL** | OAuth2 Client Secret for Google OAuth |
| `STRIPE_SECRET_KEY` | Optional | Staging / Prod | **CRITICAL** | Live Stripe secret key (`sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET`| Optional | Staging / Prod | **CRITICAL** | Stripe webhook signing secret (`whsec_...`) |
| `SENDGRID_API_KEY` | Optional | Staging / Prod | **CRITICAL** | Outbound transactional email delivery key |
| `TWILIO_ACCOUNT_SID` | Optional | Staging / Prod | High | Twilio telephony SID for SMS workflows |
| `TWILIO_AUTH_TOKEN` | Optional | Staging / Prod | **CRITICAL** | Twilio authentication token |

---

## 3. Database Lifecycle & Migration Strategy

### Migration Execution
Operza maintains 14 sequential PostgreSQL migrations in `packages/db/migrations/`:
1. `001_initial_schema.sql`: Core agencies, locations, users, and base RLS policies.
2. `002_custom_fields.sql`: Dynamic schema definition for CRM objects.
3. `003_smart_lists.sql`: Contact query filtering and segmentation views.
4. `004_bulk_actions.sql`: Batch operation queuing.
5. `005_audit_and_governance.sql`: `immutable_audit_events` and role grants.
6. `006_workflow_nodes.sql`: Automation graph schemas.
7. `007_copilot_proposals.sql`: AI action proposals and tool execution tracking.
8. `008_calendars_and_appointments.sql`: Scheduling tables.
9. `009_funnels_and_pages.sql`: Funnel steps and page templates.
10. `010_invoicing_and_payments.sql`: Invoice line items and billing history.
11. `011_platform_reconciliation.sql`: Composite key adjustments and sync indices.
12. `012_system_metrics.sql`: Real-time health metrics.
13. `013_worker_locks.sql`: Distributed lock tables for background jobs.
14. `014_governance_rules.sql`: Atlas operational policy rules.

### Migration Safety Rules
- **Idempotency:** All migrations use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and `CREATE INDEX IF NOT EXISTS`.
- **Pre-Deployment Execution:** Migrations must run prior to starting new API containers:
  ```bash
  node packages/db/scripts/migrate.mjs
  ```
- **Connection Pooling & PgBouncer Warning:** Because tenant isolation relies on `set_config('app.agency_id', ...)`, connection poolers like PgBouncer must be configured in **Session Pooling** mode (or `DISCARD ALL` / `RESET` executed when connections return to pool). Running in Transaction Pooling mode without care can bleed tenant context across requests.

---

## 4. Ingress, TLS & Reverse Proxy Architecture

```mermaid
graph LR
    User["Public Internet"] -->|HTTPS (Port 443)| Cloudflare["Cloudflare / CDN (WAF, DDoS)"]
    Cloudflare -->|TLS 1.3| Ingress["Nginx / ALB Ingress Controller"]
    Ingress -->|Static Assets| Web["operza-web (Nginx Container)"]
    Ingress -->|REST API & WS| API["operza-api (Node.js Container)"]
    API -->|TCP 5432| DB["PostgreSQL 15 (AWS RDS / Primary)"]
    API -->|TCP 6379| Redis["Redis 7 (AWS ElastiCache)"]
```

### Ingress Requirements
1. **TLS Termination:** Must enforce TLS 1.3 and HSTS (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`).
2. **Header Forwarding:** Ingress must pass:
   - `X-Forwarded-For: $proxy_add_x_forwarded_for`
   - `X-Forwarded-Proto: https`
   - `X-Forwarded-Host: $host`
3. **WebSocket Support:** Upgrades for `/api/ws` (Copilot live streaming and notification pub/sub) require:
   ```nginx
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   ```

---

## 5. Backup, Disaster Recovery & High Availability

### RPO & RTO Targets
- **Recovery Point Objective (RPO):** < 5 minutes (via PostgreSQL continuous WAL archiving).
- **Recovery Time Objective (RTO):** < 15 minutes (automated container restart / ECS task spin-up).

### Backup Procedures
1. **Automated Nightly Database Snapshots:** Full `pg_dump` of PostgreSQL relational tables and `operza_app_state`.
2. **State Store File Backup:** Volume backup of `apps/api/data/store.json` using encrypted S3 sync (`aws s3 sync apps/api/data s3://operza-backups/state/`).
3. **Disaster Recovery Playbook:**
   - Step 1: Provision new database instance.
   - Step 2: Restore from latest S3 snapshot (`pg_restore -d operza backup.dump`).
   - Step 3: Run `node packages/db/scripts/migrate.mjs` to ensure schema currency.
   - Step 4: Deploy API container pointing to restored database URL.
   - Step 5: Verify health endpoint `/api/health`.
