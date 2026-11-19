-- Migration 024: Least Privilege & Worker Location Hardening
-- 1. Explicitly revoke EXECUTE from PUBLIC on all security definer helper functions.
-- 2. Restrict helper function execution strictly to operza_app (and operza_worker for approval expiry).
-- 3. Eliminate location wildcard in operza_worker RLS policies, enforcing strict (agency_id, location_id) boundaries.
-- 4. Recreate expire_pending_workflow_approvals with composite key updates.
-- 5. Grant necessary least-privilege privileges on all tables & sequences to operza_app and operza_worker.

-- =========================================================================
-- 1. REVOKE DEFAULT EXECUTE PRIVILEGES FROM PUBLIC
-- =========================================================================
REVOKE ALL ON FUNCTION resolve_auth_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION lookup_user_for_auth(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION lookup_public_calendar(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION expire_pending_workflow_approvals() FROM PUBLIC;

-- =========================================================================
-- 2. STRICT FUNCTION PRIVILEGES TO LEAST-PRIVILEGED ROLES
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT EXECUTE ON FUNCTION resolve_auth_session(text) TO operza_app;
    GRANT EXECUTE ON FUNCTION lookup_user_for_auth(text) TO operza_app;
    GRANT EXECUTE ON FUNCTION lookup_public_calendar(text) TO operza_app;
    GRANT EXECUTE ON FUNCTION expire_pending_workflow_approvals() TO operza_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    -- operza_worker must NEVER execute user credential lookup or session resolution
    REVOKE ALL ON FUNCTION lookup_user_for_auth(text) FROM operza_worker;
    REVOKE ALL ON FUNCTION resolve_auth_session(text) FROM operza_worker;
    -- operza_worker may only execute approval expiration
    GRANT EXECUTE ON FUNCTION expire_pending_workflow_approvals() TO operza_worker;
  END IF;
END $$;

-- =========================================================================
-- 3. RECREATE EXPIRE_PENDING_WORKFLOW_APPROVALS WITH COMPOSITE KEY MATCHING
-- =========================================================================
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
    SET status = 'expired',
        decided_at = now(),
        decision_checksum = encode(sha256(('expired:' || now() || ':' || r.id)::bytea), 'hex')
    WHERE workflow_approvals.agency_id = r.agency_id
      AND workflow_approvals.location_id = r.location_id
      AND workflow_approvals.id = r.id;

    UPDATE workflow_executions
    SET status = 'failed',
        last_error_code = 'APPROVAL_EXPIRED',
        finished_at = now(),
        updated_at = now()
    WHERE workflow_executions.agency_id = r.agency_id
      AND workflow_executions.location_id = r.location_id
      AND workflow_executions.id = r.execution_id
      AND workflow_executions.status = 'waiting_approval';

    UPDATE workflow_execution_steps
    SET status = 'failed',
        error_code = 'APPROVAL_EXPIRED',
        finished_at = now()
    WHERE workflow_execution_steps.agency_id = r.agency_id
      AND workflow_execution_steps.location_id = r.location_id
      AND workflow_execution_steps.execution_id = r.execution_id
      AND workflow_execution_steps.node_id = r.node_id
      AND workflow_execution_steps.status = 'waiting_approval';

    expired_approval_id := r.id;
    agency_id := r.agency_id;
    location_id := r.location_id;
    execution_id := r.execution_id;
    node_id := r.node_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- =========================================================================
-- 4. HARDEN WORKER RLS POLICIES — EXACT LOCATION ISOLATION (NO WILDCARD)
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    -- Location records: exact location isolation
    DROP POLICY IF EXISTS location_records_worker_scope ON location_records;
    CREATE POLICY location_records_worker_scope ON location_records
      FOR ALL TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      );

    -- Opportunities: exact location isolation
    DROP POLICY IF EXISTS opportunities_worker_scope ON opportunities;
    CREATE POLICY opportunities_worker_scope ON opportunities
      FOR ALL TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      );

    -- Appointments: exact location isolation
    DROP POLICY IF EXISTS appointments_worker_scope ON appointments;
    CREATE POLICY appointments_worker_scope ON appointments
      FOR ALL TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      );

    -- Workflow executions: exact location isolation
    DROP POLICY IF EXISTS workflow_executions_worker_scope ON workflow_executions;
    CREATE POLICY workflow_executions_worker_scope ON workflow_executions
      FOR ALL TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      );

    -- Workflow execution steps: exact location isolation
    DROP POLICY IF EXISTS workflow_execution_steps_worker_scope ON workflow_execution_steps;
    CREATE POLICY workflow_execution_steps_worker_scope ON workflow_execution_steps
      FOR ALL TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      );

    -- Workflow approvals: exact location isolation
    DROP POLICY IF EXISTS workflow_approvals_worker_scope ON workflow_approvals;
    CREATE POLICY workflow_approvals_worker_scope ON workflow_approvals
      FOR ALL TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      );

    -- Workflow action receipts: exact location isolation
    DROP POLICY IF EXISTS workflow_action_receipts_worker_scope ON workflow_action_receipts;
    CREATE POLICY workflow_action_receipts_worker_scope ON workflow_action_receipts
      FOR ALL TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      )
      WITH CHECK (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      );

    -- Communication consents: exact location isolation
    DROP POLICY IF EXISTS communication_consents_worker_scope ON communication_consents;
    CREATE POLICY communication_consents_worker_scope ON communication_consents
      FOR SELECT TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
      );
  END IF;

  -- Ensure operza_app also has explicit communication_consents scope
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    DROP POLICY IF EXISTS communication_consents_app_scope ON communication_consents;
    CREATE POLICY communication_consents_app_scope ON communication_consents
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
-- 5. EXPLICIT GRANTS TO OPERZA_APP AND OPERZA_WORKER (NO ARTIFICIAL SUPERUSER GRANTS NEEDED)
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT USAGE ON SCHEMA public TO operza_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO operza_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      agencies, users, agency_memberships, locations, auth_sessions, agency_audit_events,
      calendars, appointments, pipelines, pipeline_stages, opportunities, location_records,
      workflow_definitions, workflow_executions, workflow_execution_steps,
      workflow_approvals, workflow_outbox, communication_consents,
      provider_connections, provider_secrets, provider_oauth_states,
      workflow_action_receipts, tenant_entitlements, usage_events,
      zapier_rest_hook_subscriptions, zapier_rest_hook_deliveries, copilot_proposals
    TO operza_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT USAGE ON SCHEMA public TO operza_worker;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO operza_worker;
    GRANT SELECT ON workflow_definitions, calendars, communication_consents, provider_secrets TO operza_worker;
    GRANT SELECT, INSERT, UPDATE ON
      workflow_executions, workflow_execution_steps, workflow_approvals,
      location_records, opportunities, appointments, workflow_action_receipts,
      zapier_rest_hook_subscriptions, zapier_rest_hook_deliveries, worker_heartbeats
    TO operza_worker;
    GRANT SELECT, UPDATE ON workflow_outbox TO operza_worker;
  END IF;
END $$;
