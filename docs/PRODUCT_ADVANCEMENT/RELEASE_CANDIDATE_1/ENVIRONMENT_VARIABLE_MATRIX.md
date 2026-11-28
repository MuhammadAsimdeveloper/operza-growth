# Environment Variable Matrix

Inventoried from all `process.env.*` references across `apps/` and `packages/` (no secret values included).

| Variable | Used By | Dev Behavior | Staging / Prod Req | Secret? | Startup / Runtime Notes |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | API, Web, DB | `development` | `production` | No | Controls cookie `Secure` flag, error verbosity, fallback rules |
| `PORT` / `HOST` | `apps/api/server.mjs` | `4000` / `0.0.0.0` | Required (ECS port) | No | |
| `DATABASE_URL` | API, DB, Worker | Optional (JSON fallback) | **Required** (`operza_app`) | **Yes** | Staging/prod must fail closed without it |
| `WORKER_DATABASE_URL` | Worker | Optional | **Required** (`operza_worker`) | **Yes** | Non-superuser `NOBYPASSRLS` role |
| `MIGRATION_DATABASE_URL` / `ADMIN_DATABASE_URL` | `packages/db/scripts/migrate.mjs` | Optional | **Required** (CI/CD job only) | **Yes** | Table-owner migration role; never given to runtime API |
| `PGSSL` / `DATABASE_SSL` | DB pools | `false` locally | `true` (`sslmode=require`) | No | Required for RDS TLS |
| `PG_POOL_MAX` / `PG_MAX_POOL` / `WORKER_DB_POOL_MAX` | DB pools | Default pool size | Tuned per task | No | Consolidate `PG_POOL_MAX` vs `PG_MAX_POOL` |
| `REDIS_URL` | Queue, Rate limiter | In-memory fallback | **Required** (ElastiCache) | **Yes** | Auth token + TLS in staging/prod |
| `DISTRIBUTED_RATE_LIMIT_STRICT` | Rate limiter | `false` | **`true`** | No | Prevents silent in-memory rate-limit fallback |
| `SESSION_SECRET` | Auth cookies | Dev ephemeral fallback | **Required** (32+ bytes) | **Yes** | Rotate via Secrets Manager |
| `OPERZA_VAULT_KEY` | `secret-vault.mjs` | Refuses built-in fallback | **Required** (or AWS KMS) | **Yes** | Vault explicitly fails closed without key |
| `OPERZA_ADMIN_KEY` | `/metrics`, `/api/admin/*` | Optional | **Required** | **Yes** | Gates admin telemetry & ops endpoints |
| `OPERZA_WEBHOOK_INGEST_SECRET` | Webhook ingress | Optional | **Required** | **Yes** | HMAC verification |
| `ALLOWED_ORIGINS` / `APP_BASE_URL` / `FRONTEND_URL` / `PUBLIC_BASE_URL` | CORS, OAuth, SEO | `localhost` | **Required** (exact HTTPS origins) | No | Must match CloudFront/ALB domains |
| `TRUST_PROXY` / `TRUSTED_PROXIES` | IP extraction | `false` | **`true`** (ALB CIDR) | No | Required behind ALB/CloudFront |
| `CLAMAV_BIN` / `CLAMAV_REQUIRED` | Upload scanner | `false` locally | `CLAMAV_REQUIRED=true` | No | Requires ClamAV sidecar |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Payments | Absent (fail closed) | Required for Commerce | **Yes** | Live keys only after compliance sign-off |
| `RESEND_API_KEY`, `SENDGRID_API_KEY`, `SENDGRID_WEBHOOK_KEY`, `SMTP_HOST` | Email | Absent (simulated/fail closed) | Required for Email | **Yes** | |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_CALLER_ID`, `VOICE_SESSION_SIGNING_SECRET` | Telephony / SMS | Absent (fail closed) | Required for SMS/Voice | **Yes** | |
| `META_GRAPH_API_VERSION` | WhatsApp | Default v20.0+ | Optional override | No | |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI` | OAuth | Absent | Required for OAuth | **Yes** | |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `AI_API_KEY`, `AI_PROVIDER`, `AI_MODEL`, `OLLAMA_BASE_URL`, `LOCALAI_BASE_URL` | AI Platform | Absent (unconfigured state) | Optional per enabled provider | **Yes** (API keys) | |
| `OPERZA_ENABLE_PROVIDER_ADAPTERS`, `OPERZA_LIVE_MESSAGING`, `LIVE_PROVIDER_TESTS` | Feature gates | `false` | Explicit opt-in in staging | No | Safety gates preventing accidental live sends |
| `WORKER_ID`, `WORKER_CONCURRENCY`, `WORKER_BATCH_SIZE`, `WORKER_POLL_INTERVAL_MS`, `WORKER_LEASE_MS`, `WORKER_HEARTBEAT_INTERVAL_MS` | Worker runtime | Sensible defaults | Tuned per ECS task | No | |
| `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_AUTH_MAX` | Rate limiter | Defaults | Tuned per environment | No | |
