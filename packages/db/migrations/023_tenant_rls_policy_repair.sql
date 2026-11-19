-- Migration 023: Tenant RLS Policy Repair & Least-Privilege Role Hardening
-- Drops all permissive USING (true) policies introduced in migrations 018, 020, and 022.
-- Restores strict tenant isolation for operza_app and operza_worker roles.
-- Implements security-definer helper functions for authentication and session resolution.

DO $$
BEGIN
  -- =========================================================================
  -- 1. DROP ALL PERMISSIVE USING (true) / WITH CHECK (true) POLICIES
  -- =========================================================================

  -- Drop permissive operza_app policies from migration 022
  DROP POLICY IF EXISTS users_app_read_scope ON users;
  DROP POLICY IF EXISTS users_app_signup_scope ON users;
  DROP POLICY IF EXISTS agencies_app_read_scope ON agencies;
  DROP POLICY IF EXISTS agencies_app_signup_scope ON agencies;
  DROP POLICY IF EXISTS locations_app_read_scope ON locations;
  DROP POLICY IF EXISTS locations_app_signup_scope ON locations;
  DROP POLICY IF EXISTS memberships_app_read_scope ON agency_memberships;
  DROP POLICY IF EXISTS memberships_app_signup_scope ON agency_memberships;

  -- Drop unrestricted public calendar policy from migration 015
  DROP POLICY IF EXISTS calendars_public_lookup ON calendars;

  -- Drop permissive operza_worker policies from migration 020
  DROP POLICY IF EXISTS workflow_executions_worker_scope ON workflow_executions;
  DROP POLICY IF EXISTS workflow_execution_steps_worker_scope ON workflow_execution_steps;
  DROP POLICY IF EXISTS workflow_approvals_worker_scope ON workflow_approvals;
  DROP POLICY IF EXISTS workflow_definitions_worker_scope ON workflow_definitions;
  DROP POLICY IF EXISTS location_records_worker_scope ON location_records;
  DROP POLICY IF EXISTS opportunities_worker_scope ON opportunities;

  -- Drop permissive operza_worker policies from migration 018
  DROP POLICY IF EXISTS zapier_rest_hook_subscriptions_worker_scope ON zapier_rest_hook_subscriptions;
  DROP POLICY IF EXISTS zapier_rest_hook_deliveries_worker_scope ON zapier_rest_hook_deliveries;
  DROP POLICY IF EXISTS provider_secrets_worker_scope ON provider_secrets;
  DROP POLICY IF EXISTS workflow_action_receipts_tenant_scope ON workflow_action_receipts;

  -- =========================================================================
  -- 2. ENFORCE FORCE ROW LEVEL SECURITY ON ALL TENANT-BOUND TABLES
  -- =========================================================================
  ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
  ALTER TABLE agencies FORCE ROW LEVEL SECURITY;

  ALTER TABLE users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE users FORCE ROW LEVEL SECURITY;

  ALTER TABLE agency_memberships ENABLE ROW LEVEL SECURITY;
  ALTER TABLE agency_memberships FORCE ROW LEVEL SECURITY;

  ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE locations FORCE ROW LEVEL SECURITY;

  ALTER TABLE location_records ENABLE ROW LEVEL SECURITY;
  ALTER TABLE location_records FORCE ROW LEVEL SECURITY;

  ALTER TABLE agency_audit_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE agency_audit_events FORCE ROW LEVEL SECURITY;

  ALTER TABLE workflow_definitions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE workflow_definitions FORCE ROW LEVEL SECURITY;

  ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE workflow_executions FORCE ROW LEVEL SECURITY;

  ALTER TABLE workflow_execution_steps ENABLE ROW LEVEL SECURITY;
  ALTER TABLE workflow_execution_steps FORCE ROW LEVEL SECURITY;

  ALTER TABLE workflow_approvals ENABLE ROW LEVEL SECURITY;
  ALTER TABLE workflow_approvals FORCE ROW LEVEL SECURITY;

  ALTER TABLE calendars ENABLE ROW LEVEL SECURITY;
  ALTER TABLE calendars FORCE ROW LEVEL SECURITY;

  ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE appointments FORCE ROW LEVEL SECURITY;

  ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
  ALTER TABLE pipelines FORCE ROW LEVEL SECURITY;

  ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
  ALTER TABLE pipeline_stages FORCE ROW LEVEL SECURITY;

  ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
  ALTER TABLE opportunities FORCE ROW LEVEL SECURITY;

  ALTER TABLE communication_consents ENABLE ROW LEVEL SECURITY;
  ALTER TABLE communication_consents FORCE ROW LEVEL SECURITY;

  ALTER TABLE provider_connections ENABLE ROW LEVEL SECURITY;
  ALTER TABLE provider_connections FORCE ROW LEVEL SECURITY;

  ALTER TABLE provider_secrets ENABLE ROW LEVEL SECURITY;
  ALTER TABLE provider_secrets FORCE ROW LEVEL SECURITY;

  ALTER TABLE provider_oauth_states ENABLE ROW LEVEL SECURITY;
  ALTER TABLE provider_oauth_states FORCE ROW LEVEL SECURITY;

  ALTER TABLE workflow_action_receipts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE workflow_action_receipts FORCE ROW LEVEL SECURITY;

  ALTER TABLE zapier_rest_hook_subscriptions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE zapier_rest_hook_subscriptions FORCE ROW LEVEL SECURITY;

  ALTER TABLE zapier_rest_hook_deliveries ENABLE ROW LEVEL SECURITY;
  ALTER TABLE zapier_rest_hook_deliveries FORCE ROW LEVEL SECURITY;

  -- =========================================================================
  -- 3. REINFORCE STRICT TENANT POLICIES FOR OPERZA_APP
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT USAGE ON SCHEMA public TO operza_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      agencies, users, agency_memberships, locations, auth_sessions, agency_audit_events,
      calendars, appointments, pipelines, pipeline_stages, opportunities, location_records,
      workflow_definitions, workflow_executions, workflow_execution_steps,
      workflow_approvals, workflow_outbox, communication_consents,
      provider_connections, provider_secrets, provider_oauth_states,
      workflow_action_receipts, tenant_entitlements, usage_events,
      zapier_rest_hook_subscriptions, zapier_rest_hook_deliveries
    TO operza_app;

    -- Ensure app-specific strict policies are in place
    DROP POLICY IF EXISTS agencies_app_strict_scope ON agencies;
    CREATE POLICY agencies_app_strict_scope ON agencies
      FOR ALL TO operza_app
      USING (id = nullif(current_setting('app.agency_id', true), '')::uuid)
      WITH CHECK (id = nullif(current_setting('app.agency_id', true), '')::uuid);

    DROP POLICY IF EXISTS locations_app_strict_scope ON locations;
    CREATE POLICY locations_app_strict_scope ON locations
      FOR ALL TO operza_app
      USING (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid)
      WITH CHECK (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid);

    DROP POLICY IF EXISTS memberships_app_strict_scope ON agency_memberships;
    CREATE POLICY memberships_app_strict_scope ON agency_memberships
      FOR ALL TO operza_app
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        OR user_id = nullif(current_setting('app.user_id', true), '')::uuid
      )
      WITH CHECK (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid);

    DROP POLICY IF EXISTS users_app_strict_scope ON users;
    CREATE POLICY users_app_strict_scope ON users
      FOR ALL TO operza_app
      USING (
        id = nullif(current_setting('app.user_id', true), '')::uuid
        OR id IN (
          SELECT user_id FROM agency_memberships
          WHERE agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        )
      )
      WITH CHECK (id = nullif(current_setting('app.user_id', true), '')::uuid);

    DROP POLICY IF EXISTS calendars_app_scope ON calendars;
    CREATE POLICY calendars_app_scope ON calendars
      FOR ALL TO operza_app
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND (
          nullif(current_setting('app.location_id', true), '') IS NULL
          OR location_id = nullif(current_setting('app.location_id', true), '')::uuid
        )
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND (
          nullif(current_setting('app.location_id', true), '') IS NULL
          OR location_id = nullif(current_setting('app.location_id', true), '')::uuid
        )
      );

    DROP POLICY IF EXISTS appointments_app_scope ON appointments;
    CREATE POLICY appointments_app_scope ON appointments
      FOR ALL TO operza_app
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      );

    DROP POLICY IF EXISTS workflow_action_receipts_app_scope ON workflow_action_receipts;
    CREATE POLICY workflow_action_receipts_app_scope ON workflow_action_receipts
      FOR ALL TO operza_app
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND (
          nullif(current_setting('app.location_id', true), '') IS NULL
          OR location_id = nullif(current_setting('app.location_id', true), '')::uuid
        )
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND (
          nullif(current_setting('app.location_id', true), '') IS NULL
          OR location_id = nullif(current_setting('app.location_id', true), '')::uuid
        )
      );
  END IF;

  -- =========================================================================
  -- 4. RECREATE STRICT TENANT POLICIES FOR OPERZA_WORKER
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT USAGE ON SCHEMA public TO operza_worker;
    GRANT SELECT ON workflow_definitions, calendars, communication_consents, provider_secrets TO operza_worker;
    GRANT SELECT, INSERT, UPDATE ON
      workflow_executions, workflow_execution_steps, workflow_approvals,
      location_records, opportunities, appointments, workflow_action_receipts,
      zapier_rest_hook_subscriptions, zapier_rest_hook_deliveries
    TO operza_worker;
    GRANT SELECT, UPDATE ON workflow_outbox TO operza_worker;

    -- Workflow definitions: read-only, strict tenant scope
    CREATE POLICY workflow_definitions_worker_scope ON workflow_definitions
      FOR SELECT TO operza_worker
      USING (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid);

    -- Workflow executions: full lifecycle, strict tenant scope
    CREATE POLICY workflow_executions_worker_scope ON workflow_executions
      FOR ALL TO operza_worker
      USING (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid)
      WITH CHECK (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid);

    -- Workflow execution steps: step traces, strict tenant scope
    CREATE POLICY workflow_execution_steps_worker_scope ON workflow_execution_steps
      FOR ALL TO operza_worker
      USING (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid)
      WITH CHECK (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid);

    -- Workflow approvals: lookup & update, strict tenant scope
    CREATE POLICY workflow_approvals_worker_scope ON workflow_approvals
      FOR ALL TO operza_worker
      USING (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid)
      WITH CHECK (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid);

    -- Location records: CRM actions, strict tenant & location scope
    CREATE POLICY location_records_worker_scope ON location_records
      FOR ALL TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND (
          nullif(current_setting('app.location_id', true), '') IS NULL
          OR location_id = nullif(current_setting('app.location_id', true), '')::uuid
        )
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND (
          nullif(current_setting('app.location_id', true), '') IS NULL
          OR location_id = nullif(current_setting('app.location_id', true), '')::uuid
        )
      );

    -- Opportunities: CRM actions, strict tenant & location scope
    CREATE POLICY opportunities_worker_scope ON opportunities
      FOR ALL TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND (
          nullif(current_setting('app.location_id', true), '') IS NULL
          OR location_id = nullif(current_setting('app.location_id', true), '')::uuid
        )
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND (
          nullif(current_setting('app.location_id', true), '') IS NULL
          OR location_id = nullif(current_setting('app.location_id', true), '')::uuid
        )
      );

    -- Appointments: calendar operations, strict tenant & location scope
    DROP POLICY IF EXISTS appointments_worker_scope ON appointments;
    CREATE POLICY appointments_worker_scope ON appointments
      FOR ALL TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND (
          nullif(current_setting('app.location_id', true), '') IS NULL
          OR location_id = nullif(current_setting('app.location_id', true), '')::uuid
        )
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND (
          nullif(current_setting('app.location_id', true), '') IS NULL
          OR location_id = nullif(current_setting('app.location_id', true), '')::uuid
        )
      );

    -- Calendars: read-only, strict tenant scope
    DROP POLICY IF EXISTS calendars_worker_scope ON calendars;
    CREATE POLICY calendars_worker_scope ON calendars
      FOR SELECT TO operza_worker
      USING (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid);

    -- Provider secrets: read-only, strict tenant scope
    CREATE POLICY provider_secrets_worker_scope ON provider_secrets
      FOR SELECT TO operza_worker
      USING (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid);

    -- Workflow action receipts: persistence of receipts, strict tenant scope
    DROP POLICY IF EXISTS workflow_action_receipts_worker_scope ON workflow_action_receipts;
    CREATE POLICY workflow_action_receipts_worker_scope ON workflow_action_receipts
      FOR ALL TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND (
          nullif(current_setting('app.location_id', true), '') IS NULL
          OR location_id = nullif(current_setting('app.location_id', true), '')::uuid
        )
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND (
          nullif(current_setting('app.location_id', true), '') IS NULL
          OR location_id = nullif(current_setting('app.location_id', true), '')::uuid
        )
      );

    -- Zapier subscriptions & deliveries: strict tenant scope
    CREATE POLICY zapier_rest_hook_subscriptions_worker_scope ON zapier_rest_hook_subscriptions
      FOR ALL TO operza_worker
      USING (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid)
      WITH CHECK (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid);

    CREATE POLICY zapier_rest_hook_deliveries_worker_scope ON zapier_rest_hook_deliveries
      FOR ALL TO operza_worker
      USING (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid)
      WITH CHECK (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid);
  END IF;
END $$;

-- =========================================================================
-- 5. SECURITY DEFINER HELPER FUNCTIONS (AUTH & SESSION RESOLUTION)
-- =========================================================================

-- Secure Session Resolution Function
-- Resolves an active session token and returns associated actor information
-- without requiring permissive SELECT access on users and agencies tables.
CREATE OR REPLACE FUNCTION resolve_auth_session(p_token_hash text)
RETURNS TABLE (
  id uuid,
  token_hash text,
  csrf_hash text,
  user_id uuid,
  agency_id uuid,
  expires_at_ms double precision,
  user_name text,
  user_email text,
  user_status text,
  agency_name text,
  agency_slug text,
  agency_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT s.id, s.token_hash, s.csrf_hash, s.user_id, s.agency_id,
         extract(epoch from s.expires_at) * 1000 AS expires_at_ms,
         u.name as user_name, u.email as user_email, u.status as user_status,
         a.name as agency_name, a.slug as agency_slug, a.status as agency_status
  FROM auth_sessions s
  JOIN users u ON u.id = s.user_id
  JOIN agencies a ON a.id = s.agency_id
  WHERE s.token_hash = p_token_hash AND s.expires_at > now();
$$;

-- Secure User Lookup for Authentication
-- Allows looking up active user by email during login without exposing global SELECT on users.
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
AS $$
  SELECT u.id, u.name, u.email, u.password_hash, u.status
  FROM users u
  WHERE lower(u.email) = lower(p_email) AND u.status = 'active';
$$;

-- Secure Public Calendar Lookup by Slug or ID
-- Restricts public lookup to single active calendar matching exact identifier
CREATE OR REPLACE FUNCTION lookup_public_calendar(p_id_or_slug text)
RETURNS TABLE (
  id uuid,
  agency_id uuid,
  location_id uuid,
  name text,
  slug text,
  color text,
  duration_min integer,
  availability jsonb,
  round_robin boolean,
  description text,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, agency_id, location_id, name, slug, color, duration_min, availability, round_robin, description, status
  FROM calendars
  WHERE (id::text = p_id_or_slug OR slug = p_id_or_slug) AND status = 'active'
  LIMIT 1;
$$;

-- Secure Authoritative Workflow Approvals Expiration
-- Transactionally transitions expired pending approvals to 'expired' and marks
-- associated executions and paused steps as failed with APPROVAL_EXPIRED across tenants
CREATE OR REPLACE FUNCTION expire_pending_workflow_approvals()
RETURNS TABLE (
  expired_approval_id uuid,
  agency_id uuid,
  location_id uuid,
  execution_id uuid,
  node_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT a.id, a.agency_id, a.location_id, a.execution_id, a.node_id
    FROM workflow_approvals a
    WHERE a.status = 'pending' AND a.expires_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE workflow_approvals
    SET status = 'expired', decided_at = now(), decision_checksum = encode(sha256(('expired:' || now() || ':' || r.id)::bytea), 'hex')
    WHERE workflow_approvals.id = r.id;

    UPDATE workflow_executions
    SET status = 'failed', last_error_code = 'APPROVAL_EXPIRED', finished_at = now(), updated_at = now()
    WHERE workflow_executions.id = r.execution_id AND workflow_executions.status = 'waiting_approval';

    UPDATE workflow_execution_steps
    SET status = 'failed', error_code = 'APPROVAL_EXPIRED', finished_at = now()
    WHERE workflow_execution_steps.execution_id = r.execution_id AND workflow_execution_steps.node_id = r.node_id AND workflow_execution_steps.status = 'waiting_approval';

    expired_approval_id := r.id;
    agency_id := r.agency_id;
    location_id := r.location_id;
    execution_id := r.execution_id;
    node_id := r.node_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Grant execution rights on security definer helper functions to operza_app and operza_worker
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT EXECUTE ON FUNCTION resolve_auth_session(text) TO operza_app;
    GRANT EXECUTE ON FUNCTION lookup_user_for_auth(text) TO operza_app;
    GRANT EXECUTE ON FUNCTION lookup_public_calendar(text) TO operza_app;
    GRANT EXECUTE ON FUNCTION expire_pending_workflow_approvals() TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT EXECUTE ON FUNCTION expire_pending_workflow_approvals() TO operza_worker;
  END IF;
END $$;
