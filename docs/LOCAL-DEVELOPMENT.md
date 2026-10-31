# Operza Local Development & Zero-Cost Simulation Guide

## 1. Zero-Cost Engineering Philosophy

Operza is engineered to be 100% self-contained for local development. Developers can run, test, and debug the entire SaaS platform on a workstation without any cloud accounts, paid API keys, or AWS billing.

---

## 2. Prerequisites

- **Node.js:** v20.x or higher (`node -v`)
- **Package Manager:** npm v10.x or higher (`npm -v`)
- **Git:** Standard git client
- **Optional Container Runtime:** Docker Desktop or Podman (for PostgreSQL 16 & Redis 7 verification)

---

## 3. Quick Start

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment
Copy the example environment file:
```bash
cp .env.example .env
```
Default local settings use zero-cost mock providers:
```dotenv
PORT=4000
WEB_PORT=5173
SESSION_SECRET=operza-local-development-secret-key-32chars
EMAIL_PROVIDER=mock
SMS_PROVIDER=mock
PAYMENT_PROVIDER=mock
```

### Step 3: Start Development Servers
```bash
npm run dev
```
This boots both the API backend and Vite frontend:
- **Web Application:** `http://localhost:5173`
- **Unified API:** `http://localhost:4000`
- **Health Telemetry:** `http://localhost:4000/health`
- **Readiness Telemetry:** `http://localhost:4000/ready`
- **Prometheus Metrics:** `http://localhost:4000/metrics`
- **Real-time WebSocket:** `ws://localhost:4000/ws`

---

## 4. Running With Real PostgreSQL & Redis (Optional Docker)

To run against a real PostgreSQL 16 engine and Redis 7 queue locally:

```bash
# Start PostgreSQL 16 & Redis 7 containers
npm run docker:up

# Run database migrations
npm run db:migrate

# Start application connected to PostgreSQL
DATABASE_URL=postgresql://operza_app:operza_dev_password@localhost:5432/operza_db REDIS_URL=redis://localhost:6379 npm run dev
```

---

## 5. Verification & Test Suites

Operza includes an extensive automated test battery containing 205 total automated checks:

```bash
# Execute the complete automated test suite
npm test
```
The suite executes three verification pipelines:
1. **Workflow Engine Unit Tests:** 8 tests covering graph walker traversal, rule evaluator, template engine, and determinism.
2. **Technical SEO & Metadata Audit:** 106 automated checks auditing canonical tags, sitemaps, robots.txt, and Open Graph cards.
3. **End-to-End System Integration & Security Battery:** 91 comprehensive tests validating auth, multi-tenant isolation, billing, webhooks, GDPR export, and password reset.

### Type Safety & Production Bundle Verification
```bash
# Verify TypeScript strict type-checking
npm run typecheck

# Verify Vite production asset bundling
npm run build
```
