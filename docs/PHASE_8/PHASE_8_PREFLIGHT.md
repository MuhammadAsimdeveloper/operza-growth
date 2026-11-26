# Phase 8 Preflight — Production Launch Hardening & Security Certification

**Date:** 2026-11-26
**Branch:** `feat/operza-agency-launch-readiness`
**Starting HEAD:** `f88e7d1b249079335a85d55cf617dffff6e53518` (`f88e7d1`)
**Working Tree:** Clean (`[ahead 13]`, not pushed)

---

## 1. Infrastructure & Tooling Inventory
- **PostgreSQL 18 (`C:\Program Files\PostgreSQL\18\bin`):** Available (`pg_dump.exe`, `pg_restore.exe`, `postgres.exe`, `initdb.exe`).
- **`pgvector` (`vector.control`):** NOT installed on this Windows host (`double precision[]` + `pg_trgm` fallback active).
- **Redis (`redis-server`) & Docker:** NOT installed on this Windows host (Redis multi-worker queue scaling cannot be locally executed and is marked as an external staging/production prerequisite).
- **External Provider Credentials:** Stripe live keys, Twilio live keys/Media Streams, SendGrid live keys, Gemini/OpenAI/Anthropic keys, and live ACME/DNS edge proxy are NOT configured in this local environment.

## 2. Inherited Limitations Register (Phases 0–7)
1. **Phase 3:** Stripe Connect, Twilio, SendGrid, WhatsApp, and A2P remain sandbox/adapter-verified without live production credentials.
2. **Phase 5:** Native `pgvector` binary absent locally; AI provider keys unconfigured; live Twilio Media Streams transport unverified.
3. **Phase 6:** Custom-domain DNS TXT and ACME/HTTPS verification tested with deterministic resolvers/fixtures; live public edge TLS termination not yet deployed.
4. **Phase 7:** SaaS subscriptions, OAuth 2.0 PKCE, Marketplace lifecycle, Platform Admin separation, and PWA cache isolation implemented; live recurring Stripe webhook cutover pending.
