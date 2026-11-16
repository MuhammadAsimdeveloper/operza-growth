---
name: operza-postgres-validation
description: Operza-specific procedure for multi-version PostgreSQL validation, isolated database creation, least-privilege role audits, and GiST concurrency testing.
---

# Operza PostgreSQL Verification & Database Compliance Procedure

Use this skill when testing database migrations, validating multi-tenant Row-Level Security (RLS), running appointment concurrency tests, or checking database engine compatibility across PostgreSQL 16 and 18.

---

## 1. Absolute Data & System Protections

1. **NEVER modify or reset `apps/api/data/store.json`**: This file contains persistent seed/test state. Never pass it to tests as a mutable target; always use isolated temporary JSON files (e.g. `scratch/store_test.json`).
2. **NEVER touch or reinitialize PostgreSQL 18**: The host runs PostgreSQL 18 on port 5432. Never stop or reinitialize service `postgresql-x64-18`.
3. **NEVER run tests against production or unverified databases**: All test connection strings must contain `test` in their database name (enforced by `assertSafeTestDatabaseUrl`).
4. **NEVER commit credentials, passwords, or secrets** into source control or documentation.

---

## 2. PostgreSQL Binary & Engine Selection

On this Windows host, both engines coexist:
- **PostgreSQL 18.0 (Windows Service):** `C:\Program Files\PostgreSQL\18\bin` (Port 5432)
- **PostgreSQL 16.6 (EnterpriseDB Binaries):** `D:\PostgreSQL\16\bin` (Port 5433)

To target PostgreSQL 16 explicitly:
```powershell
$env:PG_BIN_DIR = "D:\PostgreSQL\16\bin"
& "D:\PostgreSQL\16\bin\psql.exe" -U postgres -p 5433 -h 127.0.0.1 -c "SELECT version();"
```

The test harness in `packages/db/lib/test-postgres-server.mjs` checks `process.env.PG_BIN_DIR` and `D:\PostgreSQL\16\bin` first.

---

## 3. Safe Isolated Verification Database Procedure

### Step 1: Create Disposable Test Database
Connect as administrator (`postgres`) to port 5433:
```powershell
& "D:\PostgreSQL\16\bin\psql.exe" -U postgres -p 5433 -h 127.0.0.1 -d postgres -c "DROP DATABASE IF EXISTS operza_pg16_verify;" -c "CREATE DATABASE operza_pg16_verify;"
```

### Step 2: Pre-Create Required Extensions
```powershell
& "D:\PostgreSQL\16\bin\psql.exe" -U postgres -p 5433 -h 127.0.0.1 -d operza_pg16_verify -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"
```

### Step 3: Bootstrap Least-Privilege Roles
Run `packages/db/scripts/bootstrap-roles.sql`:
```powershell
& "D:\PostgreSQL\16\bin\psql.exe" -U postgres -p 5433 -h 127.0.0.1 -d operza_pg16_verify -f "packages/db/scripts/bootstrap-roles.sql"
```

### Step 4: Verify Role Attributes (`pg_roles`)
Ensure `operza_app` and `operza_worker` are `NOSUPERUSER` and `NOBYPASSRLS`:
```sql
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls 
FROM pg_roles WHERE rolname LIKE 'operza%';
```

---

## 4. Migration Execution

Run migrations using the official repository runner:
```powershell
$env:MIGRATION_DATABASE_URL = "postgresql://postgres@127.0.0.1:5433/operza_pg16_verify"
node packages/db/scripts/migrate.mjs
```
Verify that all 15 migrations succeed and are logged in `schema_migrations`:
```sql
SELECT count(*) FROM schema_migrations; -- Must return 15
```

---

## 5. Targeted Test Execution Commands

Run targeted suites with `OPERZA_TEST_DATABASE_URL` pointing to the isolated test database:

```powershell
$env:OPERZA_TEST_DATABASE_URL = "postgresql://postgres@127.0.0.1:5433/operza_pg16_verify"

# 1. RLS & Tenant Isolation Test
node --test packages/db/test/real-postgres-integration.test.mjs

# 2. Database Concurrency & GiST Exclusion Test (15 scenarios)
node --test packages/db/test/appointment-concurrency.test.mjs

# 3. Multi-Process API Concurrency Test (9 scenarios across 2 instances)
node --test apps/api/test/appointment-concurrency-api.test.mjs
```

---

## 6. Honest Audit Classification Rules

When reporting compatibility status:
- **`VERIFIED`**: Integration tests actually executed and passed against a live server reporting the targeted major version.
- **`PARTIALLY VERIFIED`**: Migrations applied, but integration suites were run against mock or alternate engine versions.
- **`BLOCKED`**: The engine runtime is unavailable locally or missing critical dependencies (e.g., Docker not installed, ports inaccessible).
- **`FAILED`**: Explicit runtime or assertion error occurred.

Never report `VERIFIED` based solely on code inspection or feature compatibility matrices.
