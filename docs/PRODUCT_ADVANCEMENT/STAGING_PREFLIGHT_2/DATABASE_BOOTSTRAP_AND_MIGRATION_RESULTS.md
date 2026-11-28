# Database Bootstrap & Migration Results

- **Migration Sequence (`001`–`054`):** Executed `runMigrationPipeline` (`stage21_local_sim.mjs`) against `IsolatedTestPostgres`.
  - **Stage A:** Verified `postgres` superuser bootstrap -> created `operza_auth_definer`, `operza_migrator`, `operza_app`, `operza_worker`.
  - **Stage B:** Connected strictly as `operza_migrator` (`NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOINHERIT`) and applied all **54** migrations (`001` through `054_operza_app_state_table.sql`) with `0` errors.
- **RDS Compatibility (`packages/db/scripts/bootstrap-rds-roles.sql`):** Reviewed for Amazon RDS (`rds_superuser` lacks true `SUPERUSER` and `CREATE EVENT TRIGGER` restrictions); `bootstrap-rds-roles.sql` creates all 4 roles, extensions, and default privileges without requiring `rolsuper`. Actual RDS execution remains pending AWS provisioning.
