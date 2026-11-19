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

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_auth_definer') THEN
    CREATE ROLE operza_auth_definer NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

GRANT operza_auth_definer TO operza_migrator;

SELECT format('GRANT CONNECT ON DATABASE %I TO operza_migrator, operza_app, operza_worker', current_database()) \gexec
GRANT USAGE, CREATE ON SCHEMA public TO operza_migrator, operza_auth_definer;
GRANT USAGE ON SCHEMA public TO operza_app, operza_worker;

CREATE OR REPLACE FUNCTION trg_fix_migrator_templates()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.object_type = 'policy' AND cmd.object_identity LIKE '%workflow_templates%' THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'workflow_templates' AND policyname = 'workflow_templates_migrator_policy'
      ) THEN
        EXECUTE 'CREATE POLICY workflow_templates_migrator_policy ON workflow_templates FOR ALL TO operza_migrator USING (true) WITH CHECK (true)';
      END IF;
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS trg_migrator_templates_rls;
CREATE EVENT TRIGGER trg_migrator_templates_rls ON ddl_command_end
EXECUTE FUNCTION trg_fix_migrator_templates();

ALTER DEFAULT PRIVILEGES FOR ROLE operza_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO operza_app, operza_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE operza_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO operza_app, operza_worker;

