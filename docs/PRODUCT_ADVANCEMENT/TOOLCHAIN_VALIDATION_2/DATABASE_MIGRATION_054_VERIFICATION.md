# Database Migration 054 Verification

- **Fresh Install (`001`–`054`):** Verified in `stage21_local_sim.mjs` & `stage-18-hardening.test.mjs` (`operza_migrator`, `126/126` `agency_id` tables with `FORCE RLS`).
- **Upgrade Path (`001`–`053` -> `054`):** Verified in `stage22_verify.mjs` against `IsolatedTestPostgres`:
  - `operza_migrator` applied `054_operza_app_state_table.sql` cleanly (`totalMigrations: 54`).
  - `pg_tables.tableowner` for `operza_app_state` = **`operza_migrator`**.
  - `operza_app` (`NOSUPERUSER, NOBYPASSRLS`) executed `SELECT COUNT(*) FROM operza_app_state` cleanly (`appSelectOk: true`) without needing `CREATE` on `public`.
