# Distributed Rate Limiting Verification (Phase 8.2)

- **Module:** `packages/platform-core/src/security/auth-rate-limiter.mjs`
- **Wired Endpoints:** `POST /api/auth/login` (`apps/api/routes/auth.mjs`), `POST /api/oauth/authorize`, `POST /api/oauth/token` (`apps/api/routes/phase7.mjs`).
- **Trusted Proxy & Spoofing:** `extractTrustedClientIp()` ignores `X-Forwarded-For` / `X-Real-IP` unless `trustProxy: true` AND `req.socket.remoteAddress` is in `trustedProxies`.
- **Degraded Mode:** Added `strictDistributed` (`DISTRIBUTED_RATE_LIMIT_STRICT=true` in `docker-compose.staging.yml`) so horizontally scaled staging nodes fail closed (`RATE_LIMIT_BACKEND_UNAVAILABLE`) instead of silently degrading to per-instance in-memory counters.
- **Multi-Instance Redis Test Status:** **BLOCKED locally** (Redis not installed on Windows host). Single-instance fallback & Redis error-handling verified in `phase8-1-remediation.test.mjs`.
