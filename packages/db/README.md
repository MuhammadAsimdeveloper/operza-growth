# @operza/db

Enterprise PostgreSQL database migrations, role provisioning, and strict multi-tenant Row-Level Security (RLS) enforcement for Operza.

---

## 🔐 Multi-Tenant Security & Role Separation

Operza isolates tenant data at the PostgreSQL engine level using Row-Level Security (RLS) policies rather than relying purely on application-level filtering.

### Three-Tier Database Roles:
1. **`operza_admin`**: Superuser for container initialization, database creation, and role bootstrapping.
2. **`operza_migrator`**: Privileged role with DDL permissions (`CREATE TABLE`, `ALTER TABLE`, `CREATE POLICY`) used exclusively during automated schema migrations.
3. **`operza_app`**: Unprivileged runtime application role. Restricted by PostgreSQL RLS policies; cannot bypass tenant boundaries.

### Row-Level Security Mechanism
At the start of every tenant request, the API executes:
```sql
SELECT set_config('app.agency_id', 'AGENCY_UUID', true);
SELECT set_config('app.location_id', 'LOCATION_UUID', true);
```

All table queries automatically apply the corresponding RLS policy:
```sql
CREATE POLICY agency_isolation_policy ON contacts
  FOR ALL
  TO operza_app
  USING (agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid);
```

---



## Platform control-plane tables

Migrations 008 and 009 add provider connections, communication consent events, workflow approvals, action receipts, leased workflow outbox records, tenant entitlements, usage events and Copilot proposals. These tables are protected by transaction-local RLS context (app.agency_id, and app.location_id where applicable).

The outbox repository is available at lib/outbox-repository.mjs. It provides tenant-scoped enqueue and action receipts for the application role, plus row-locking claims, renewable leases, retry scheduling and dead-letter transitions for a dedicated worker role.

To provision the worker:
1. Apply migrations 008–009 using the migrator role.
2. Run packages/db/operations/provision_worker_role.sql as a database owner/superuser.
3. Set a strong worker password through the deployment secret manager.
4. Configure WORKER_DATABASE_URL with that role; the worker verifies current_user = operza_worker on startup.
5. Configure only trusted event handlers in a local ESM module and set WORKFLOW_JOB_MODULE.

The worker role is intentionally not permitted to mutate CRM contacts, users, payment records or provider secrets. It has access to outbox and action receipt tables only. Do not reuse DATABASE_URL for the worker.

## 🛠️ Migrations

Run database migrations via the migrator role:
```bash
npm run db:migrate
```
Or from the root workspace:
```bash
npm run db:migrate
```
