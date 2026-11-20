-- Migration 025: Workflow Definition & Calendar Location Hardening, Auth Definer Role & Real Least-Privilege Matrix
-- 1. Provisions dedicated operza_auth_definer role (NOLOGIN, BYPASSRLS) with minimal table grants.
-- 2. Transfers ownership of security-definer helper functions to operza_auth_definer.
-- 3. Hardens workflow_definitions RLS policies for operza_worker and operza_app to require exact location_id.
-- 4. Hardens calendars RLS policies for operza_worker and operza_app to require exact location_id.
-- 5. Hardens workflow_action_receipts_app_scope to require exact location_id (eliminates IS NULL wildcard).
-- 6. Enforces exact table-operation least-privilege matrix (audit log append-only, worker no-delete).

-- =========================================================================
-- 1. DEDICATED SECURITY DEFINER FUNCTION OWNER ROLE
-- =========================================================================
DO $$
BEGIN
  -- Attempt deterministic role creation. If the role does not exist, CREATE ROLE is executed.
  -- Only duplicate_object is caught to safely accommodate concurrent bootstrap races.
  -- Any privilege failure (e.g. insufficient_privilege / permission denied) FAILS VISIBLY.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_auth_definer') THEN
    BEGIN
      CREATE ROLE operza_auth_definer WITH NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;

  -- Ensure the migration runner is granted membership in operza_auth_definer
  -- so it can reassign function ownership to operza_auth_definer.
  IF NOT pg_has_role(current_user, 'operza_auth_definer', 'MEMBER') AND
     NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('GRANT operza_auth_definer TO %I', current_user);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_migrator') THEN
    IF NOT pg_has_role('operza_migrator', 'operza_auth_definer', 'MEMBER') THEN
      GRANT operza_auth_definer TO operza_migrator;
    END IF;
  END IF;
END $$;

-- Verify operza_auth_definer exists and possesses exact required attributes
DO $$
DECLARE
  v_super boolean;
  v_login boolean;
  v_bypass boolean;
  v_createdb boolean;
  v_createrole boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_auth_definer') THEN
    RAISE EXCEPTION 'CRITICAL: Required role operza_auth_definer does not exist. Database bootstrap must provision this role.';
  END IF;

  SELECT rolsuper, rolcanlogin, rolbypassrls, rolcreatedb, rolcreaterole
  INTO v_super, v_login, v_bypass, v_createdb, v_createrole
  FROM pg_roles WHERE rolname = 'operza_auth_definer';

  IF v_super THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: operza_auth_definer must NOT be a superuser';
  END IF;
  IF v_login THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: operza_auth_definer must NOT have LOGIN permission (NOLOGIN required)';
  END IF;
  IF NOT v_bypass THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: operza_auth_definer must have BYPASSRLS to execute security-definer helpers';
  END IF;
  IF v_createdb THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: operza_auth_definer must NOT have CREATEDB';
  END IF;
  IF v_createrole THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: operza_auth_definer must NOT have CREATEROLE';
  END IF;
END $$;

-- Verify runtime roles operza_app and operza_worker exist and possess exact least-privilege attributes
-- NOTE: In Operza's security architecture, operza_app and operza_worker are provisioned during initial
-- database bootstrap (e.g. migrate.mjs, bootstrap-roles.sql). Migration 025 strictly requires both roles.
DO $$
DECLARE
  v_count integer;
  v_role record;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_roles
  WHERE rolname IN ('operza_app', 'operza_worker');

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'CRITICAL: Required runtime roles (operza_app, operza_worker) do not exist (found %). Database bootstrap must provision both roles.', v_count;
  END IF;

  FOR v_role IN
    SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit
    FROM pg_roles
    WHERE rolname IN ('operza_app', 'operza_worker')
    ORDER BY rolname
  LOOP
    IF v_role.rolsuper THEN
      RAISE EXCEPTION 'SECURITY_VIOLATION: % must NOT be a superuser', v_role.rolname;
    END IF;
    IF v_role.rolbypassrls THEN
      RAISE EXCEPTION 'SECURITY_VIOLATION: % must NOT have BYPASSRLS', v_role.rolname;
    END IF;
    IF v_role.rolcreatedb THEN
      RAISE EXCEPTION 'SECURITY_VIOLATION: % must NOT have CREATEDB', v_role.rolname;
    END IF;
    IF v_role.rolcreaterole THEN
      RAISE EXCEPTION 'SECURITY_VIOLATION: % must NOT have CREATEROLE', v_role.rolname;
    END IF;
    IF NOT v_role.rolcanlogin THEN
      RAISE EXCEPTION 'SECURITY_VIOLATION: % must have LOGIN permission', v_role.rolname;
    END IF;
    IF v_role.rolinherit THEN
      RAISE EXCEPTION 'SECURITY_VIOLATION: % must have NOINHERIT', v_role.rolname;
    END IF;
  END LOOP;
END $$;

-- Apply least-privilege schema & table grants to operza_auth_definer and transfer function ownership
GRANT USAGE ON SCHEMA public TO operza_auth_definer;
GRANT SELECT ON users, auth_sessions, agencies, calendars TO operza_auth_definer;
GRANT SELECT, UPDATE ON workflow_approvals, workflow_executions, workflow_execution_steps TO operza_auth_definer;

-- Update lookup_user_for_auth to return user record including status (allowing USER_INACTIVE detection)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_roles r ON p.proowner = r.oid
    WHERE p.proname = 'lookup_user_for_auth' AND r.rolname = 'operza_auth_definer'
  ) AND pg_has_role(current_user, 'operza_auth_definer', 'MEMBER') THEN
    EXECUTE 'SET ROLE operza_auth_definer';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION lookup_user_for_auth(p_email text)
RETURNS TABLE (
  id uuid,
  name text,
  email text,
  password_hash text,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $func$
  SELECT u.id, u.name, u.email, u.password_hash, u.status
  FROM users u
  WHERE lower(u.email) = lower(p_email);
$func$;

DO $$
BEGIN
  IF pg_has_role(session_user, 'operza_auth_definer', 'MEMBER') THEN
    RESET ROLE;
  END IF;
END $$;

-- Reassign ownership of security definer helper functions to operza_auth_definer
DO $$
BEGIN
  IF (SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON p.proowner = r.oid WHERE p.proname = 'resolve_auth_session') <> 'operza_auth_definer' THEN
    ALTER FUNCTION resolve_auth_session(text) OWNER TO operza_auth_definer;
  END IF;
  IF (SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON p.proowner = r.oid WHERE p.proname = 'lookup_user_for_auth') <> 'operza_auth_definer' THEN
    ALTER FUNCTION lookup_user_for_auth(text) OWNER TO operza_auth_definer;
  END IF;
  IF (SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON p.proowner = r.oid WHERE p.proname = 'lookup_public_calendar') <> 'operza_auth_definer' THEN
    ALTER FUNCTION lookup_public_calendar(text) OWNER TO operza_auth_definer;
  END IF;
  IF (SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON p.proowner = r.oid WHERE p.proname = 'expire_pending_workflow_approvals') <> 'operza_auth_definer' THEN
    ALTER FUNCTION expire_pending_workflow_approvals() OWNER TO operza_auth_definer;
  END IF;
END $$;

-- =========================================================================
-- 2. HARDEN WORKFLOW DEFINITIONS LOCATION ISOLATION
-- =========================================================================
DO $$
BEGIN
  -- Drop legacy agency-wide and generic tenant policies
  DROP POLICY IF EXISTS workflow_definitions_tenant_scope ON workflow_definitions;
  DROP POLICY IF EXISTS workflow_definitions_worker_scope ON workflow_definitions;
  DROP POLICY IF EXISTS workflow_definitions_app_scope ON workflow_definitions;

  -- operza_worker: read-only, strict agency AND location scope
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    CREATE POLICY workflow_definitions_worker_scope ON workflow_definitions
      FOR SELECT TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      );
  END IF;

  -- operza_app: full lifecycle, strict agency AND location scope
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    CREATE POLICY workflow_definitions_app_scope ON workflow_definitions
      FOR ALL TO operza_app
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      );
  END IF;
END $$;

-- =========================================================================
-- 3. HARDEN CALENDARS LOCATION ISOLATION
-- =========================================================================
DO $$
BEGIN
  -- Drop legacy agency-wide and wildcard policies
  DROP POLICY IF EXISTS calendars_tenant_scope ON calendars;
  DROP POLICY IF EXISTS calendars_worker_scope ON calendars;
  DROP POLICY IF EXISTS calendars_app_scope ON calendars;

  -- operza_worker: read-only, strict agency AND location scope
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    CREATE POLICY calendars_worker_scope ON calendars
      FOR SELECT TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      );
  END IF;

  -- operza_app: full lifecycle, strict agency AND location scope (no NULL wildcard)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    CREATE POLICY calendars_app_scope ON calendars
      FOR ALL TO operza_app
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      );
  END IF;
END $$;

-- =========================================================================
-- 4. HARDEN WORKFLOW ACTION RECEIPTS APP SCOPE (REMOVE IS NULL WILDCARD)
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    DROP POLICY IF EXISTS workflow_action_receipts_app_scope ON workflow_action_receipts;
    CREATE POLICY workflow_action_receipts_app_scope ON workflow_action_receipts
      FOR ALL TO operza_app
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      );
  END IF;
END $$;

-- =========================================================================
-- 5. REAL LEAST-PRIVILEGE TABLE OPERATION MATRIX
-- =========================================================================
DO $$
BEGIN
  -- 5.1 Immutable Audit Logs: operza_app can only SELECT and INSERT (never UPDATE or DELETE)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    REVOKE UPDATE, DELETE ON agency_audit_events FROM operza_app;
    GRANT SELECT, INSERT ON agency_audit_events TO operza_app;

    -- Worker heartbeats: operza_app can only read heartbeats (worker writes them)
    REVOKE INSERT, UPDATE, DELETE ON worker_heartbeats FROM operza_app;
    GRANT SELECT ON worker_heartbeats TO operza_app;
  END IF;

  -- 5.2 operza_worker: strict least-privilege operations (never DELETE)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    -- Revoke DELETE across all worker tables
    REVOKE DELETE ON
      workflow_definitions, calendars, communication_consents, provider_secrets,
      workflow_executions, workflow_execution_steps, workflow_approvals,
      location_records, opportunities, appointments, workflow_action_receipts,
      zapier_rest_hook_subscriptions, zapier_rest_hook_deliveries, worker_heartbeats,
      workflow_outbox
    FROM operza_worker;

    -- Explicit permissions per matrix:
    -- Read-only tables for worker:
    GRANT SELECT ON workflow_definitions, calendars, communication_consents, provider_secrets TO operza_worker;

    -- Lifecycle & execution tables:
    GRANT SELECT, INSERT, UPDATE ON
      workflow_executions, workflow_execution_steps, workflow_approvals,
      location_records, opportunities, appointments, workflow_action_receipts,
      zapier_rest_hook_deliveries, worker_heartbeats
    TO operza_worker;

    -- Queue & subscriptions:
    GRANT SELECT, UPDATE ON workflow_outbox, zapier_rest_hook_subscriptions TO operza_worker;
  END IF;
END $$;
