# Operza — PostgreSQL 16 Setup & Empirical Verification Report

**Document ID:** `ENG-POSTGRES-16-VERIFICATION`  
**Date:** November 9, 2026  
**Status:** **VERIFIED**  
**Author:** Principal DevOps & Database Reliability Engineer  

---

## 1. Engine Installation & Dual-Instance Coexistence

To satisfy multi-version engine validation, PostgreSQL 16 was deployed side-by-side with the pre-existing PostgreSQL 18 installation on this Windows host.

### 1.1 Coexistence Topology

| Engine | Version | Binary Directory | Data Directory | Listening Port | Management / Status |
|---|---|---|---|---|---|
| **PostgreSQL 18** | `18.0 (x64)` | `C:\Program Files\PostgreSQL\18\bin` | `C:\Program Files\PostgreSQL\18\data` | `127.0.0.1:5432` | Windows Service `postgresql-x64-18` (Untouched, Active) |
| **PostgreSQL 16** | `16.6 (x64)` | `D:\PostgreSQL\16\bin` | `D:\PostgreSQL\16\data` | `127.0.0.1:5433` | Dedicated Host Daemon (Active, Verified) |

### 1.2 Storage & Host Constraints
- **Drive C Capacity:** Host drive `C:` has `1.04 GB` free space and standard NTFS security prevents un-elevated writing to `C:\Program Files\PostgreSQL\16`. Drive `D:` had `71.4 GB` available.
- **Engine Deployment:** Official EnterpriseDB PostgreSQL 16.6 64-bit binaries were deployed to `D:\PostgreSQL\16` with the dedicated cluster at `D:\PostgreSQL\16\data`.
- **Initialization:** Cluster initialized via `initdb` with `UTF-8` encoding and `C` locale.
- **Network Configuration:** Bound to `127.0.0.1, ::1` on port `5433` with `max_connections = 100`.

---

## 2. Database & Role Privilege Verification

### 2.1 Verification Database
- **Database:** `operza_pg16_test`

### 2.2 Role Audit (`pg_roles`)
Provisioned via `packages/db/scripts/bootstrap-roles.sql`:
```sql
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls 
FROM pg_roles WHERE rolname LIKE 'operza%';
```
```
     rolname     | rolsuper | rolinherit | rolcreaterole | rolcreatedb | rolcanlogin | rolbypassrls 
-----------------+----------+------------+---------------+-------------+-------------+--------------
 operza_migrator | f        | f          | f             | f           | t           | f
 operza_app      | f        | f          | f             | f           | t           | f
 operza_worker   | f        | f          | f             | f           | t           | f
```
- Both `operza_app` and `operza_worker` are strictly non-superuser (`rolsuper = f`) and cannot bypass RLS (`rolbypassrls = f`).

---

## 3. Migration Execution: 15 / 15 Passed

Applied sequentially via `node packages/db/scripts/migrate.mjs`:
- `001_agency_tenant_core.sql`
- `002_public_form_registry.sql`
- `003_workflow_executions.sql`
- `004_workflow_templates.sql`
- `005_agency_snapshots.sql`
- `006_ecosystem_and_telephony.sql`
- `007_workflow_step_simulation_status.sql`
- `008_platform_foundation.sql`
- `009_copilot_proposals.sql`
- `010_zapier_and_agent_suite.sql`
- `011_platform_reconciliation.sql`
- `012_durable_workflow_leases.sql`
- `013_transactional_billing_ledger.sql`
- `014_immutable_audit_events.sql`
- `015_appointment_concurrency_exclusion.sql`

Verified all 15 applied records in `schema_migrations`.

### Critical Constraint Verifications on PostgreSQL 16:
- `chk_appointments_time_range`: `CHECK (ends_at > starts_at)`
- `exclude_overlapping_active_appointments`:
  ```sql
  EXCLUDE USING gist (
    agency_id WITH =,
    location_id WITH =,
    calendar_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status <> 'cancelled')
  ```
- `FORCE ROW LEVEL SECURITY`: Verified active on all 9 multi-tenant core entities (`agencies`, `locations`, `users`, `agency_memberships`, `contacts`, `opportunities`, `calendars`, `appointments`, `billing_ledger_accounts`).

---

## 4. Empirical Integration Test Evidence

Three targeted test suites were executed directly against PostgreSQL 16:

1. **`packages/db/test/real-postgres-integration.test.mjs`**
   - **Result:** 3 / 3 Passed (0 Failed, 0 Skipped).
   - Validates safety URL guards, 15 migration files, and active RLS isolation.

2. **`packages/db/test/appointment-concurrency.test.mjs`**
   - **Result:** 15 / 15 Passed (0 Failed, 0 Skipped).
   - Validates 20-worker burst collision, half-open interval adjacent slots, slot release on cancellation, and rollback safety.

3. **`apps/api/test/appointment-concurrency-api.test.mjs`**
   - **Result:** 9 / 9 Passed (0 Failed, 0 Skipped).
   - Validates two independent API processes (ports 4301 & 4302) sharing the PostgreSQL 16 instance. Concurrent overlapping booking attempts return HTTP 409 Conflict.

**Total Verified Tests on PostgreSQL 16:** 27 / 27 Passed (100%).

---

## 5. Blockers & Limitations

- **Remaining Blockers:** Zero. Full compatibility verified.
