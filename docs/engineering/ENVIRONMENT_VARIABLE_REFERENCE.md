# Operza Growth — Environment Variable Reference

This document provides a complete, authoritative reference for all environment variables supported by Operza across development, staging, and production environments.

---

## 1. Core Server & Runtime Settings

| Variable | Type | Default | Required? | Description |
|---|---|---|---|---|
| `NODE_ENV` | string | `development` | No | Runtime environment (`development`, `test`, `staging`, `production`). In staging/production, strict database and secret requirements are enforced. |
| `PORT` | number | `4000` | No | Port on which the API HTTP and WebSocket server listens. |
| `HOST` | string | `0.0.0.0` | No | Network host interface binding. |
| `PUBLIC_BASE_URL` | url | `http://localhost:4000` | No | Public URL for webhook callbacks, public booking pages, and email links. |
| `APP_BASE_URL` | url | `http://localhost:5173` | No | URL of the frontend web application for OAuth redirects. |
| `SESSION_SECRET` | string | (dev fallback) | **Yes (Prod)** | Minimum 32-character cryptographic key used to sign session cookies and CSRF tokens. Fails startup in staging/prod if unset. |
| `OPERZA_VAULT_KEY` | string | (dev fallback) | **Yes (Prod)** | Minimum 16-character (recommended 32-byte) master encryption key for AES-256-GCM secret vault storage. |
| `OPERZA_ADMIN_KEY` | string | (unset) | No | Optional static bearer token required for unauthenticated calls to `/api/admin/*` telemetry routes. |

---

## 2. Database & Persistence Layer

| Variable | Type | Default | Required? | Description |
|---|---|---|---|---|
| `DATABASE_URL` | url | (unset) | **Yes (Prod)** | PostgreSQL connection string for the unprivileged application role (`operza_app`). Must have `NOBYPASSRLS`. |
| `DATABASE_SSL` | boolean | `false` | No | Set to `true` to require SSL/TLS database connections (standard for AWS RDS / Supabase). |
| `MIGRATION_DATABASE_URL` | url | (unset) | No | Dedicated PostgreSQL connection string for the table owner/migrator role (`operza_migrator`). |
| `PLATFORM_DB_ENABLED` | boolean | `false` | No | Enables normalized relational database persistence for provider secrets, consents, proposals, and usage ledgers. Defaults to true in staging/production. |
| `PG_MAX_POOL` | number | `10` | No | Maximum number of concurrent connections in the PostgreSQL client pool. |

---

## 3. Distributed Queue & Durable Worker

| Variable | Type | Default | Required? | Description |
|---|---|---|---|---|
| `REDIS_URL` | url | (unset) | No | Redis connection string (`redis://` or `rediss://`). If omitted, uses an in-memory high-precision durable queue. |
| `WORKER_DATABASE_URL` | url | (unset) | No | Dedicated connection string for the background worker (`operza_worker`). |
| `WORKER_ID` | string | `operza-worker-1` | No | Unique worker instance identifier for outbox lease ownership. |
| `WORKER_BATCH_SIZE` | number | `10` | No | Number of outbox events claimed in a single execution tick. |
| `WORKER_LEASE_MS` | number | `30000` | No | Duration in milliseconds that a worker lease remains valid before expiring. |
| `WORKER_CONCURRENCY` | number | `4` | No | Maximum simultaneous executions per worker instance. |

---

## 4. Microsoft Outlook & Graph OAuth

| Variable | Type | Default | Required? | Description |
|---|---|---|---|---|
| `MICROSOFT_CLIENT_ID` | string | (unset) | No | Azure App Registration Application (client) ID. |
| `MICROSOFT_CLIENT_SECRET` | string | (unset) | No | Azure App Registration Client Secret value. |
| `MICROSOFT_REDIRECT_URI` | url | (unset) | No | OAuth callback redirect URI (e.g. `https://api.operza.io/api/platform/oauth/outlook/callback`). |
| `MICROSOFT_TENANT_ID` | string | `common` | No | Microsoft Azure tenant ID (`common` for multi-tenant Microsoft accounts). |

---

## 5. Third-Party Provider Credentials (Optional / Per-Tenant)

| Variable | Type | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | string | Global platform Stripe API secret key. |
| `STRIPE_WEBHOOK_SECRET` | string | Global Stripe webhook signing secret (`whsec_...`). |
| `TWILIO_ACCOUNT_SID` | string | Global platform Twilio Account SID (`AC...`). |
| `TWILIO_AUTH_TOKEN` | string | Global platform Twilio Auth Token. |
| `SENDGRID_API_KEY` | string | Global SendGrid API Key (`SG....`). |
| `RESEND_API_KEY` | string | Global Resend API Key (`re_...`). |
| `OPENAI_API_KEY` | string | OpenAI API key for AI Copilot and embeddings. |
| `ANTHROPIC_API_KEY` | string | Anthropic API key for Claude 3.5 Sonnet Copilot reasoning. |

---

## 6. Rate Limiting & Abuse Prevention

| Variable | Type | Default | Description |
|---|---|---|---|
| `RATE_LIMIT_MAX_REQUESTS` | number | `120` | Maximum requests permitted per client IP per minute. |
| `RATE_LIMIT_AUTH_MAX` | number | `10` | Stricter limit applied exclusively to `/api/auth/*` routes. |
