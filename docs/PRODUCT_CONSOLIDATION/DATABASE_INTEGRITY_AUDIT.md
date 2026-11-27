# Stage 8 — Database & Data Integrity Audit

**Date:** 2026-11-27  
**Baseline Commit:** `044f203`  
**Verification Method:** Executed `node scripts/verify-ci-postgres.mjs` against an isolated ephemeral PostgreSQL cluster (`127.0.0.1:55100`).

---

## 1. Migration & Role Architecture (`001`–`045`)
- **Sequential Migration Chain:** All **45** migrations (`001_agency_tenant_core.sql` through `045_analytics_2_0.sql`) applied cleanly in deterministic sequence under the unprivileged `operza_migrator` role (`NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOINHERIT`).
- **Role Separation:**
  - `postgres` (bootstrap only, Stage A).
  - `operza_migrator` (schema owner, Stage B migrations).
  - `operza_app` (runtime API queries, constrained by `TenantTx` + `FORCE ROW LEVEL SECURITY`).
  - `operza_worker` (background outbox/workflow execution, scoped grants).
- **FORCE RLS Coverage:** `99` `FORCE ROW LEVEL SECURITY` directives verified across `packages/db/migrations/*.sql`.

## 2. Test Suite Execution Results (Baseline `044f203`)
- `npm --workspace=@operza/db test` (via `verify-ci-postgres.mjs`): **143/143 passed** (`0` failures) against real PostgreSQL, including `FORCE RLS` tenant isolation, `TenantTx`, `ContactsRepository` merge + `FOR UPDATE`, `ConversationsRepository` idempotency, `CommunicationConsentsRepository`, and `Phase 20.2.5.11` ephemeral cluster teardown guarantees.
- **Step 3 Real PostgreSQL Integration Suite:** **128/130 passed, 2 failed**:
  - `apps/api/test/durable-workflow-and-postgres.test.mjs:645` (`12. Calendar synchronization fails closed on unverified provider credentials`): `actual: undefined, expected: 'CALENDAR_AUTH_FAILED'`. Root cause: `executeCalendarSync` in `packages/platform-core/src/calendar-sync.mjs` does not wrap thrown errors from `adapter.verify(...)` with `code: 'CALENDAR_AUTH_FAILED'`.

## 3. Data Integrity & Ledger Findings
- **Financial Ledger:** Uses integer minor units (`amount_cents`) and separates currencies strictly (`usd`, `pkr`, etc.) in `analytics-2-0.mjs` and `ledger-repository.mjs`.
- **Workflow Execution & Idempotency:** Action receipt claim-token fencing (`032_action_receipt_claim_token_fencing.sql`) and `30/30` idempotency scenarios passed against real PostgreSQL.
- **Analytics Deduplication:** `045_analytics_2_0.sql` enforces `UNIQUE (agency_id, location_id, source_module, deduplication_key)` to prevent double-counting.
- **GDPR Deletion:** Verified with legal-hold checks, idempotent deletion, and invoice PII anonymization.
