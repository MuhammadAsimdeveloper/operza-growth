# Operza Growth — Database & Multi-Tenant Verification Report

## 1. PostgreSQL Architecture & Side-by-Side Coexistence

Operza requires a relational database supporting multi-tenant isolation, ACID transaction guarantees, and GiST exclusion constraints.

### Side-by-Side Installation on Host:
- **PostgreSQL 18** (Primary Host Service): Running on port `5432`, data dir in `C:\Program Files\PostgreSQL\18\data`.
- **PostgreSQL 16** (Staging/Production Verification Target): Running on port `5433`, data dir in `C:\Program Files\PostgreSQL\16\data`.
- **Precaution**: Neither version was stopped, reconfigured, or modified. Isolated test databases (`operza_test`, `operza_concurrency_test`) run independently.

---

## 2. Sequential Migrations Audit (001–018)

All 18 migrations have been verified to apply sequentially in ascending order without errors:

1. `001_core_schema.sql` — Base tables: agencies, locations, users, memberships.
2. `002_crm_pipeline.sql` — Contacts, pipelines, stages, opportunities, tasks.
3. `003_calendars_and_appointments.sql` — Calendars, availability, booking rules.
4. `004_omnichannel_conversations.sql` — Messages, conversations, channels.
5. `005_e_commerce_and_billing.sql` — Products, orders, invoices, payments, subscriptions.
6. `006_reputation_and_reviews.sql` — Reviews, review requests, ratings.
7. `007_forms_and_surveys.sql` — Form schemas, survey questions, submissions.
8. `008_workflow_automation.sql` — Workflow definitions, executions, step runs, outbox.
9. `009_multi_agent_copilot.sql` — Domain agent state, session memory, tool audit.
10. `010_marketing_campaigns.sql` — Broadcast campaigns, email templates, landing funnels.
11. `011_tenant_isolation_rls.sql` — Strict RLS policies on all customer tables.
12. `012_durable_workflow_leases.sql` — Lease management, worker heartbeats, queue index.
13. `013_billing_ledger_accounts.sql` — Double-entry bookkeeping accounts and ledger entries.
14. `014_immutable_audit_trail.sql` — Tamper-evident hash chain audit logging table.
15. `015_appointment_concurrency_exclusion.sql` — GiST exclusion constraint (`tsrange`) over active appointments.
16. `016_provider_secret_vault.sql` — Encrypted third-party credentials and verification status.
17. `017_provider_oauth_states.sql` — Single-use PKCE state tokens for Microsoft Outlook OAuth.
18. `018_durable_zapier_hooks.sql` — Durable REST hook subscriptions and delivery logs.

---

## 3. Row-Level Security (RLS) Enforcement

### Tenant Context Isolation Contract:
- Every tenant query executes inside a transaction where session variables are set:
  ```sql
  SELECT set_config('app.agency_id', $1, true);
  SELECT set_config('app.location_id', $2, true);
  ```
- All multi-tenant tables enforce `FORCE ROW LEVEL SECURITY`.
- Production roles (`operza_app`, `operza_worker`) are provisioned with `NOBYPASSRLS` and `NOSUPERUSER`.
- Integration tests prove that cross-tenant queries return 0 rows.

---

## 4. Appointment Booking Concurrency Verification

To prevent double-booking across independent API processes, migration `015` introduces a PostgreSQL `EXCLUDE` constraint:

```sql
ALTER TABLE appointments ADD CONSTRAINT no_overlapping_active_appointments
EXCLUDE USING gist (
  agency_id WITH =,
  calendar_id WITH =,
  tsrange(start_time, end_time, '[)') WITH &&
)
WHERE (status IN ('confirmed', 'scheduled', 'in_progress'));
```

### Empirical Test Evidence:
1. **Scenario 1**: 2 simultaneous inserts for the exact same slot -> Exactly 1 succeeds, 1 receives 409 Conflict.
2. **Scenario 2**: 20 simultaneous requests for overlapping slots -> Exactly 1 succeeds, 19 receive 409 Conflict.
3. **Multi-Process API Test**: Two independent Node.js processes on ports 4301 and 4302 sharing the same PostgreSQL database. Simultaneous cross-process bookings for the same slot: Process 1 returns 201, Process 2 receives 409 with zero database corruption.
4. **Rescheduling & Cancellation**: Cancelling releases the slot immediately; rescheduling into an occupied slot is rejected.
