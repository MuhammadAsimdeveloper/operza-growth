# GDPR Data Export & Deletion Workflow

**Repository:** `packages/db/lib/gdpr-repository.mjs` (`TenantTx` + `FORCE RLS`)
**API Routes:** `apps/api/routes/gdpr.mjs` (`POST /api/gdpr/export`, `POST /api/gdpr/delete`)

## Implemented Technical Controls
- **Authorization:** Restricted to `owner` and `admin` roles; cross-tenant export/deletion returns `0` records under PostgreSQL `FORCE RLS`.
- **Export:** Exports contacts, appointments, tasks, conversations, and invoices with SHA-256 manifest checksum and 24h expiration timestamp without logging PII.
- **Deletion & Legal Hold:** Blocks deletion when `legalHold: true` (`GDPR_LEGAL_HOLD_ACTIVE`, HTTP `409`); idempotently deletes contacts, tasks, conversations, cancels appointments, and anonymizes invoice PII (`redacted@gdpr.invalid`) while retaining legally required financial ledger rows.
- **Disclaimer:** Technical controls are verified in `real-postgres-integration.test.mjs`; formal legal/DPO sign-off and backup-expiration schedules remain organizational requirements.
