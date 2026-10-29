-- Run once as a PostgreSQL administrator against the operza_growth database.
-- Set credentials interactively with psql's \password command after creating the roles.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_migrator') THEN
    CREATE ROLE operza_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_app') THEN
    CREATE ROLE operza_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

GRANT CONNECT ON DATABASE operza_growth TO operza_migrator, operza_app;
GRANT USAGE, CREATE ON SCHEMA public TO operza_migrator;
GRANT USAGE ON SCHEMA public TO operza_app;
ALTER DEFAULT PRIVILEGES FOR ROLE operza_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO operza_app;

