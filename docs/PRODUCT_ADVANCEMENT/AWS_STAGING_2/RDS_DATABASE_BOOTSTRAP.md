# RDS PostgreSQL 16 Bootstrap & Migrations

- **4 Least-Privilege Roles:**
  - `operza_auth_definer` (`NOLOGIN NOINHERIT BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE`)
  - `operza_migrator` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`, member of `operza_auth_definer`)
  - `operza_app` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`)
  - `operza_worker` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`)
- **RDS Superuser Nuance:** `packages/db/scripts/migrate.mjs` Stage A requires `rolsuper = true`, which Amazon RDS master users (`rds_superuser`) do not possess. For RDS staging, execute `packages/db/scripts/bootstrap-rds-roles.sql` once as `operza_rds_admin` (replacing placeholder passwords from Secrets Manager), then run `runUnprivilegedMigrations` (`MIGRATOR_DATABASE_URL`) for migrations `001`–`053`.
- **Local Verification (`stage20_local_sim.mjs`):** Two-stage pipeline applied all **53** migrations (`001`–`053`) as `operza_migrator` against `IsolatedTestPostgres` with `0` errors.
