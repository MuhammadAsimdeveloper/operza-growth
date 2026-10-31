# OPERZA — PRODUCTION ENVIRONMENT REFERENCE

> **Comprehensive Environment Variable Specification**  
> **Repository:** `https://github.com/MuhammadAsimdeveloper/operza-growth`  
> **Active Branch:** `release/production-launch`  
> **Security Policy:** All production secrets must have at least 256 bits of entropy. Never commit `.env` files to source control.

---

## 1. Quick Reference Table

| Variable | Required in Production | Default / Example | Purpose & Sensitivity |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | **Yes** | `production` | Enforces fail-closed security and production optimizations. |
| `PORT` | No | `4000` | HTTP port for backend API service. |
| `HOST` | No | `0.0.0.0` | Bind interface. |
| `PUBLIC_BASE_URL` | **Yes** | `https://app.operza.io` | Canonical base URL used for links, callbacks, and webhooks. |
| `SESSION_SECRET` | **Yes** | *Cryptographic 64-char hex* | Encrypts session cookies. Must be unique per environment. |
| `ALLOWED_ORIGINS` | **Yes** | `https://operza.io,https://app.operza.io` | Comma-separated CORS whitelist. Wildcards strictly forbidden in prod. |
| `DATABASE_URL` | **Yes** | `postgresql://operza_app:...@host:5432/operza_db` | Restricted PostgreSQL runtime connection (RLS enforced). |
| `MIGRATION_DATABASE_URL` | **Yes (Migrator)** | `postgresql://operza_migrator:...@host:5432/operza_db` | Privileged schema migration connection. |
| `PG_MAX_POOL` | No | `20` | Maximum pooled database connections per container. |
| `DATABASE_SSL` | No | `true` | Enforces SSL/TLS database connection. |
| `REDIS_URL` | **Yes** | `redis://:password@redis-host:6379` | Distributed Redis cluster for queue, leasing & deduplication. |
| `ALLOW_IN_MEMORY_QUEUE` | **Yes** | `false` | When `false`, API and worker refuse to boot if Redis is unreachable. |
| `WORKER_CONCURRENCY` | No | `5` | Maximum concurrent background jobs processed per worker tick. |
| `STRIPE_SECRET_KEY` | Optional | `sk_live_...` | Stripe payment processing secret key. |
| `STRIPE_WEBHOOK_SECRET` | **Yes (if Stripe on)**| `whsec_...` | HMAC SHA-256 signing secret for Stripe webhook verification. |
| `TWILIO_ACCOUNT_SID` | Optional | `AC...` | Twilio telephony account identifier. |
| `TWILIO_AUTH_TOKEN` | Optional | *Twilio Auth Token* | Used for cryptographic signature validation of Twilio inbound webhooks. |
| `TWILIO_PHONE_NUMBER` | Optional | `+18005550100` | Default agency outbound caller ID number. |
| `WHATSAPP_VERIFY_TOKEN`| **Yes (if WA on)** | *High-entropy secret string* | Challenge verification token for WhatsApp Cloud API handshake. |
| `WHATSAPP_APP_SECRET` | **Yes (if WA on)** | *Meta App Secret* | Computes `X-Hub-Signature-256` HMAC to verify WhatsApp messages. |
| `META_VERIFY_TOKEN` | **Yes (if Meta on)**| *High-entropy secret string* | Challenge token for Messenger / Instagram webhook handshakes. |
| `META_APP_SECRET` | **Yes (if Meta on)**| *Meta App Secret* | Computes `X-Hub-Signature-256` HMAC to verify Meta webhook payloads. |
| `OPENAI_API_KEY` | Optional | `sk-...` | Powers autonomous AI Copilot streaming and RAG embeddings. |
| `DEFAULT_LLM_MODEL` | No | `gpt-4o-mini` | Default model identifier for AI copilot responses. |
| `SENDGRID_API_KEY` | Optional | `SG...` | Transactional email delivery API key. |
| `RATE_LIMIT_MAX_REQUESTS` | No | `180` | Maximum sliding-window requests per IP per minute. |
| `RATE_LIMIT_AUTH_MAX` | No | `15` | Maximum login/signup attempts per IP per minute. |

---

## 2. Production Secret Generation Commands

Use these standard commands on your deployment host to generate production-grade keys:

```bash
# Generate 64-character hexadecimal session secret (256 bits)
openssl rand -hex 32

# Generate secure PostgreSQL database password
openssl rand -base64 24

# Generate high-entropy WhatsApp / Meta verification tokens
openssl rand -hex 20
```

---

## 3. Sample Production Configuration File (`.env.production`)

```bash
# ==============================================================================
# Operza Production Configuration Template
# ==============================================================================
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
PUBLIC_BASE_URL=https://app.operza.io
SESSION_SECRET=e7c8b21a9f34567d890123456789abcdef0123456789abcdef0123456789abcdef
ALLOWED_ORIGINS=https://operza.io,https://app.operza.io

# PostgreSQL Persistence
DATABASE_URL=postgresql://operza_app:secret_app_pw@postgres.internal:5432/operza_db?sslmode=require
MIGRATION_DATABASE_URL=postgresql://operza_migrator:secret_migrator_pw@postgres.internal:5432/operza_db?sslmode=require
PG_MAX_POOL=20
DATABASE_SSL=true

# Redis Queue & Worker
REDIS_URL=redis://:secret_redis_pw@redis.internal:6379
ALLOW_IN_MEMORY_QUEUE=false
WORKER_CONCURRENCY=10

# Cryptographic Webhook Keys
STRIPE_SECRET_KEY=sk_live_replace_with_actual_stripe_key
STRIPE_WEBHOOK_SECRET=whsec_replace_with_actual_stripe_webhook_secret
WHATSAPP_VERIFY_TOKEN=f6e2b901a8c3d4e5f7a8b9c0d1e2f3a4
WHATSAPP_APP_SECRET=replace_with_meta_app_secret
META_VERIFY_TOKEN=f6e2b901a8c3d4e5f7a8b9c0d1e2f3a4
META_APP_SECRET=replace_with_meta_app_secret

# Rate Limiting
RATE_LIMIT_MAX_REQUESTS=180
RATE_LIMIT_AUTH_MAX=15
```
