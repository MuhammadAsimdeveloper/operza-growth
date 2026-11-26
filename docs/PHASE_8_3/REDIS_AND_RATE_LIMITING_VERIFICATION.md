# Phase 8.3 — Redis & Distributed Rate-Limiting Verification

- **Pinned Staging Container:** `redis:7.4.2-alpine` (`docker-compose.staging.yml`).
- **Code Wiring:** `strictDistributed: process.env.DISTRIBUTED_RATE_LIMIT_STRICT === 'true'` wired in both `apps/api/routes/auth.mjs` (`/api/auth/login`, `/api/auth/magic-link`, `/api/auth/verify-otp`) and `apps/api/routes/phase7.mjs` (`/api/oauth/authorize`, `/api/oauth/token`).
- **Multi-Instance Redis Verification:** **BLOCKED locally** (no Docker / `redis-server` on Windows host).
- **Verified Locally:** `strictDistributed` fail-closed `RATE_LIMIT_BACKEND_UNAVAILABLE`, spoofed `X-Forwarded-For` rejection, and sliding-window recovery (`phase8-1-remediation.test.mjs`).
