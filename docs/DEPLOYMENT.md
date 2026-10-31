# Operza Production Deployment Manual

## 1. Prerequisites

- Docker 24.0+ & Docker Compose v2.20+
- Host Operating System: Linux (Ubuntu 22.04 LTS / Debian 12 / Amazon Linux 2023)
- Minimum Host Specs: 2 vCPU, 2 GB RAM, 40+ GB SSD volume
- Domain Name configured with DNS A-record pointing to host public IP (or routed via Cloudflare)

---

## 2. Docker Compose Production Deployment

### Step 1: Clone Repository & Checkout Release Branch
```bash
git clone https://github.com/MuhammadAsimdeveloper/operza-growth.git /opt/operza
cd /opt/operza
git checkout release/production-launch
```

### Step 2: Configure Production Environment Secrets
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Generate high-entropy production secrets:
```bash
# Generate 64-character cryptographic hex secrets
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('POSTGRES_PASSWORD=' + require('crypto').randomBytes(24).toString('hex'))"
```
Configure `.env` with production values:
```env
NODE_ENV=production
PORT=4000
DATABASE_URL=postgres://operza_app:<POSTGRES_PASSWORD>@postgres:5432/operza_db
MIGRATION_DATABASE_URL=postgres://operza_migrator:<POSTGRES_PASSWORD>@postgres:5432/operza_db
REDIS_URL=redis://redis:6379
SESSION_SECRET=<YOUR_GENERATED_SESSION_SECRET>
JWT_SECRET=<YOUR_GENERATED_JWT_SECRET>
ALLOWED_ORIGINS=https://operza.io,https://www.operza.io
RATE_LIMIT_MAX_REQUESTS=120
RATE_LIMIT_AUTH_MAX=10
```

### Step 3: Launch Production Container Stack
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### Step 4: Verify Service Health & Telemetry
```bash
# Verify all containers are running and healthy
docker compose -f docker-compose.prod.yml ps

# Inspect deep health endpoint
curl -s http://localhost:4000/health | jq .
```
Expected output:
```json
{
  "name": "Operza Unified API",
  "status": "healthy",
  "version": "2.0.0",
  "wsEnabled": true,
  "database": {
    "status": "connected",
    "latencyMs": 1.2
  },
  "redis": {
    "status": "connected"
  }
}
```

---

## 3. Zero-Downtime Rollback Procedure

If a deployed release experiences an unforeseen failure, execute an immediate atomic rollback:
```bash
# 1. Roll back Git pointer to previous known stable tag
git checkout <PREVIOUS_STABLE_COMMIT_OR_TAG>

# 2. Rebuild and restart application containers
docker compose -f docker-compose.prod.yml up -d --build --no-deps api web worker

# 3. Restore database snapshot if schema migration requires rollback
npm run db:restore backups/latest_stable
```
