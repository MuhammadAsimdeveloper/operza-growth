# Operza — Production Deployment Guide

## 1. System Requirements

### Hardware Sizing Guidelines

| Scale Tier | Concurrent Users | CPU Cores | Memory | Storage | Recommended Architecture |
|---|---|---|---|---|---|
| **Starter Agency** | 1–50 | 2 vCPU | 4 GB | 50 GB SSD | Single VM (Docker Compose) |
| **Growth Agency** | 50–500 | 4 vCPU | 8 GB | 200 GB NVMe | Clustered Postgres + Redis + 2x API Nodes |
| **Enterprise / Multi-Tenant** | 500+ | 8+ vCPU | 16+ GB | 500+ GB NVMe | Managed AWS Aurora Postgres / Redis + ECS / K8s |

---

## 2. Environment Configuration

Create a production `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

### Critical Environment Variables

```ini
# Runtime Environment
NODE_ENV=production
PORT=4000
HOST=0.0.0.0

# Database Persistence (PostgreSQL 16)
DATABASE_URL=postgresql://operza_app:<STRONG_PASSWORD>@postgres:5432/operza_db
PG_MAX_POOL=20
DATABASE_SSL=false

# Distributed Queue (Redis 7.x)
REDIS_URL=redis://:<STRONG_REDIS_PASSWORD>@redis:6379

# Cryptography & Sessions (Must be at least 32 characters)
SESSION_SECRET=<GENERATE_64_CHAR_RANDOM_HEX>

# Omnichannel Ingress Webhook Secrets
STRIPE_WEBHOOK_SECRET=whsec_...
TWILIO_AUTH_TOKEN=...
SENDGRID_WEBHOOK_KEY=...

# Rate Limiting
RATE_LIMIT_MAX_REQUESTS=180
RATE_LIMIT_AUTH_MAX=15
```

---

## 3. Production Deployment with Docker Compose

Operza provides a hardened production compose specification (`docker-compose.prod.yml`).

### Step 1: Initialize Database Roles and Schema
```bash
# Start Postgres to apply migrations
docker compose -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.prod.yml exec postgres psql -U operza_admin -d operza_db -f /docker-entrypoint-initdb.d/01-bootstrap-roles.sql

# Run database migrations
npm --workspace=@operza/db run migrate
```

### Step 2: Launch Complete Production Stack
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### Step 3: Verify Container Health
```bash
docker compose -f docker-compose.prod.yml ps
```

All services (`operza-prod-postgres`, `operza-prod-redis`, `operza-prod-api`, `operza-prod-web`) should show status `Up (healthy)`.

---

## 4. Reverse Proxy & SSL Configuration (Nginx Example)

```nginx
server {
    listen 80;
    server_name app.operza.io;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.operza.io;

    ssl_certificate /etc/letsencrypt/live/app.operza.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.operza.io/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Frontend Assets
    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API Proxy
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket Proxy
    location /ws {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }
}
```

---

## 5. Health Probes & Monitoring

- **Liveness Probe**: `GET http://localhost:4000/health` (HTTP 200)
- **Readiness Probe**: `GET http://localhost:4000/ready` (Verifies DB connection pool & Redis readiness)
- **Telemetry Metrics**: `GET http://localhost:4000/metrics` (Memory RSS, heap, entity counts, queue depth)
