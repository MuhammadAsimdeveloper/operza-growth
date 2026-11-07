-- Run once as a PostgreSQL administrator against the application database.
-- Sets up least-privilege roles with default passwords for container initialization.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_migrator') THEN
    CREATE ROLE operza_migrator LOGIN PASSWORD 'operza_migrator_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE operza_migrator WITH LOGIN PASSWORD 'operza_migrator_secret';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_app') THEN
    CREATE ROLE operza_app LOGIN PASSWORD 'operza_app_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE operza_app WITH LOGIN PASSWORD 'operza_app_secret';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_worker') THEN
    CREATE ROLE operza_worker LOGIN PASSWORD 'operza_worker_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE operza_worker WITH LOGIN PASSWORD 'operza_worker_secret';
  END IF;
END $$;

SELECT format('GRANT CONNECT ON DATABASE %I TO operza_migrator, operza_app, operza_worker', current_database()) \gexec
GRANT USAGE, CREATE ON SCHEMA public TO operza_migrator;
GRANT USAGE ON SCHEMA public TO operza_app, operza_worker;

ALTER DEFAULT PRIVILEGES FOR ROLE operza_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO operza_app, operza_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE operza_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO operza_app, operza_worker;

