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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_auth_definer') THEN
    BEGIN
      CREATE ROLE operza_auth_definer WITH NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN insufficient_privilege THEN NULL;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_migrator') AND
     EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_auth_definer') THEN
    BEGIN
      GRANT operza_auth_definer TO operza_migrator;
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_auth_definer') THEN
    GRANT USAGE ON SCHEMA public TO operza_auth_definer;
    GRANT SELECT ON users, auth_sessions, agencies, calendars TO operza_auth_definer;
    GRANT SELECT, UPDATE ON workflow_approvals, workflow_executions, workflow_execution_steps TO operza_auth_definer;

    -- Update lookup_user_for_auth to return user record including status (allowing USER_INACTIVE detection)
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

    -- Reassign ownership of security definer helper functions to operza_auth_definer
    ALTER FUNCTION resolve_auth_session(text) OWNER TO operza_auth_definer;
    ALTER FUNCTION lookup_user_for_auth(text) OWNER TO operza_auth_definer;
    ALTER FUNCTION lookup_public_calendar(text) OWNER TO operza_auth_definer;
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
