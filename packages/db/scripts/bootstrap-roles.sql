-- ==============================================================================
-- Operza Database Role & Permission Bootstrapper
-- ==============================================================================
-- Run once as a PostgreSQL administrator against the active Operza database.
-- Dynamically targets current_database() to prevent database name mismatch.
-- ==============================================================================

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_migrator') THEN
    CREATE ROLE operza_migrator WITH LOGIN PASSWORD 'operza_migrator_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE operza_migrator WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_app') THEN
    CREATE ROLE operza_app WITH LOGIN PASSWORD 'operza_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE operza_app WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

-- Dynamically grant connect to the active database
DO $$ 
DECLARE
  curr_db text := current_database();
BEGIN
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO operza_migrator, operza_app', curr_db);
END $$;

-- Schema permissions: Migrator owns DDL, App has usage
GRANT USAGE, CREATE ON SCHEMA public TO operza_migrator;
GRANT USAGE ON SCHEMA public TO operza_app;

-- Grant permissions on existing tables, sequences and functions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO operza_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO operza_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO operza_app;

-- Default privileges for future objects created by operza_migrator
ALTER DEFAULT PRIVILEGES FOR ROLE operza_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO operza_app;

ALTER DEFAULT PRIVILEGES FOR ROLE operza_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO operza_app;

ALTER DEFAULT PRIVILEGES FOR ROLE operza_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO operza_app;
