-- Amazon RDS PostgreSQL 16 Bootstrap (runs as rds_superuser, NO true SUPERUSER required)
-- Replace placeholder passwords via AWS Secrets Manager / psql -v before executing.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_auth_definer') THEN
    CREATE ROLE operza_auth_definer NOLOGIN NOINHERIT BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_migrator') THEN
    CREATE ROLE operza_migrator LOGIN PASSWORD 'CHANGE_ME_MIGRATOR' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    CREATE ROLE operza_app LOGIN PASSWORD 'CHANGE_ME_APP' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    CREATE ROLE operza_worker LOGIN PASSWORD 'CHANGE_ME_WORKER' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

GRANT operza_auth_definer TO operza_migrator;
GRANT ALL ON SCHEMA public TO operza_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO operza_auth_definer;
GRANT USAGE ON SCHEMA public TO operza_app, operza_worker;

ALTER DEFAULT PRIVILEGES FOR ROLE operza_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO operza_app, operza_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE operza_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO operza_app, operza_worker;
