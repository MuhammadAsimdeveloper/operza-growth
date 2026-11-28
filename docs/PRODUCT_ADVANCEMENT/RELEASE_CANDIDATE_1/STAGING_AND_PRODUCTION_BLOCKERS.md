# Staging & Production Blockers

## 1. Blockers Before Internal AWS Staging (Conditional Go)

1. **PostgreSQL Role & Schema Bootstrap:** Provision RDS PostgreSQL 16 and create `operza_app`, `operza_worker`, and `operza_auth_definer` (`NOBYPASSRLS`) before running migrations `001`–`053`.
2. **Redis & Strict Rate Limiting:** Provision ElastiCache Redis and set `REDIS_URL` + `DISTRIBUTED_RATE_LIMIT_STRICT=true` so multi-instance API/workers do not fall back to in-memory stores.
3. **Required Security Secrets:** Provision `SESSION_SECRET`, `OPERZA_VAULT_KEY` (or AWS KMS key), `OPERZA_ADMIN_KEY`, and `OPERZA_WEBHOOK_INGEST_SECRET` in AWS Secrets Manager.
4. **Object Storage & Malware Scanning:** Provision private S3 bucket and ClamAV sidecar/service if `CLAMAV_REQUIRED=true`.

## 2. Blockers Before External Customer Pilot & Production Launch (No-Go Until Resolved)

1. **Staging End-to-End Verification:** All 9 business journeys and Playwright checks must pass against live AWS staging (PostgreSQL + Redis + S3).
2. **Live Sandbox & Provider Verification:** Stripe, Resend/SendGrid, Twilio, Meta WhatsApp, Google/Microsoft OAuth, and AI provider keys must be verified in sandbox/live test mode.
3. **Distributed Load & Failover Testing:** Multi-node ECS API + Worker failover, connection pool saturation, and >100k-row query latency testing.
4. **Backup & PITR Restore Drill:** Automated restore-to-scratch-RDS drill verified with documented RPO/RTO.
5. **Independent Third-Party Security Audit:** External penetration test and security sign-off.
6. **Compliance Review:** Required before enabling live Stripe payment processing (`PAYMENTS_DISABLED_PENDING_COMPLIANCE` gate on legacy connector).
