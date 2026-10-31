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
SET LOCAL app.current_agency_id = 'AGENCY_UUID';
SET LOCAL app.current_location_id = 'LOCATION_UUID';
```

All table queries automatically apply the corresponding RLS policy:
```sql
CREATE POLICY agency_isolation_policy ON contacts
  FOR ALL
  TO operza_app
  USING (agency_id = NULLIF(current_setting('app.current_agency_id', true), '')::uuid);
```

---

## 🛠️ Migrations

Run database migrations via the migrator role:
```bash
npm run db:migrate
```
Or from the root workspace:
```bash
npm run db:migrate
```
