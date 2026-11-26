# Production Cutover Checklist

- [x] `FORCE ROW LEVEL SECURITY` verified across all 39 migrations (`operza_app` & `operza_worker`).
- [x] API security headers (`CSP`, `HSTS`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) verified.
- [x] PWA Service Worker cache purge on `logout()` and `switchLocation()` wired.
- [ ] Configure managed PostgreSQL 18 with `pgvector` binary + automated PITR (`RPO <= 15m`).
- [ ] Provision managed Redis instance and multi-worker `apps/api/worker.mjs` deployment.
- [ ] Configure live Stripe Connect, Twilio (A2P/Media Streams), SendGrid, WhatsApp, and AI provider keys.
- [ ] Configure live DNS + ACME/edge TLS termination for customer custom domains.
- [ ] Complete independent third-party penetration test (`EXTERNAL_PEN_TEST_HANDOFF.md`).
