# Observability & Incident Readiness

- **Liveness & Readiness:** `GET /health` and `GET /ready` (`apps/api/routes/system.mjs`).
- **Correlation & Audit:** `x-request-id` propagated in `sendJson()` (`apps/api/server.mjs`), `platform_admin_audit_log`, and immutable audit events.
- **Status Model:** Operational, Degraded, Partial Outage, Major Outage, Maintenance.
- **Incident Runbooks Covered:** API outage, PostgreSQL failure, Redis/worker outage, suspected cross-tenant exposure, credential leak, payment/messaging outage, failed migration, backup failure, and GDPR export/deletion failure (Severity -> Detection -> Containment -> Recovery -> Validation -> Post-Incident Review).
