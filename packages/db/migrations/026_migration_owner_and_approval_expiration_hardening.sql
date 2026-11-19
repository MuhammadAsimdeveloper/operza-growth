-- Migration 026: Migration Owner & Approval Expiration Hardening
-- 1. Fails safely and loudly if operza_auth_definer role or membership is missing.
-- 2. Revokes global approval expiration from operza_app (callable strictly by operza_worker).
-- 3. Creates tenant-scoped expire_tenant_workflow_approvals(agency_id, location_id) with strict context validation.
-- 4. Enforces least-privilege matrix and transfers function ownership to operza_auth_definer.

-- =========================================================================
-- 1. SAFE MIGRATION ROLE & DEFINER ROLE VALIDATION (NO SILENT SKIPS)
-- =========================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_auth_definer') THEN
    RAISE EXCEPTION 'Required security role operza_auth_definer does not exist. Database bootstrap must provision this role.';
  END IF;

  -- Ensure migration runner can administer/own objects of operza_auth_definer
  IF NOT pg_has_role(current_user, 'operza_auth_definer', 'MEMBER') AND
     NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Migration runner "%" is not a member of operza_auth_definer. Grant membership during bootstrap.', current_user;
  END IF;
END $$;

-- Verify operza_auth_definer has proper attributes (NOLOGIN, BYPASSRLS, NOSUPERUSER)
DO $$
DECLARE
  v_super boolean;
  v_login boolean;
  v_bypass boolean;
BEGIN
  SELECT rolsuper, rolcanlogin, rolbypassrls INTO v_super, v_login, v_bypass
  FROM pg_roles WHERE rolname = 'operza_auth_definer';

  IF v_super THEN
    RAISE EXCEPTION 'operza_auth_definer must NOT be a superuser';
  END IF;
  IF v_login THEN
    RAISE EXCEPTION 'operza_auth_definer must NOT have LOGIN permission (NOLOGIN required)';
  END IF;
  IF NOT v_bypass THEN
    RAISE EXCEPTION 'operza_auth_definer must have BYPASSRLS to execute security-definer helpers';
  END IF;
END $$;

-- Ensure schema and table privileges on operza_auth_definer are properly locked down
GRANT USAGE ON SCHEMA public TO operza_auth_definer;
GRANT SELECT ON users, auth_sessions, agencies, calendars TO operza_auth_definer;
GRANT SELECT, UPDATE ON workflow_approvals, workflow_executions, workflow_execution_steps TO operza_auth_definer;

-- =========================================================================
-- 2. REVOKE GLOBAL APPROVAL EXPIRATION FROM OPERZA_APP
-- =========================================================================
-- expire_pending_workflow_approvals() is an unrestricted global maintenance function.
-- Revoke execution from ordinary application role (operza_app) and PUBLIC.
-- Only the dedicated background worker (operza_worker) may execute global expiration.
-- Note: Function is owned by operza_auth_definer, so switch to definer role to modify privileges.
DO $$
BEGIN
  IF pg_has_role(current_user, 'operza_auth_definer', 'MEMBER') THEN
    EXECUTE 'SET ROLE operza_auth_definer';
  END IF;

  REVOKE ALL ON FUNCTION expire_pending_workflow_approvals() FROM PUBLIC;
  REVOKE ALL ON FUNCTION expire_pending_workflow_approvals() FROM operza_app;
  GRANT EXECUTE ON FUNCTION expire_pending_workflow_approvals() TO operza_worker;

  IF pg_has_role(session_user, 'operza_auth_definer', 'MEMBER') THEN
    RESET ROLE;
  END IF;
END $$;

-- =========================================================================
-- 3. CREATE STRICT TENANT-SCOPED APPROVAL EXPIRATION FUNCTION
-- =========================================================================
-- Applications needing to expire approvals during tenant request workflows must
-- call expire_tenant_workflow_approvals which strictly validates that caller session context
-- matches the target agency and location.
CREATE OR REPLACE FUNCTION expire_tenant_workflow_approvals(p_agency_id uuid, p_location_id uuid)
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
  v_curr_agency text;
  v_curr_location text;
  r record;
BEGIN
  -- Strict tenant boundary validation: verify input arguments match caller session context
  v_curr_agency := nullif(current_setting('app.agency_id', true), '');
  v_curr_location := nullif(current_setting('app.location_id', true), '');

  IF p_agency_id IS NULL OR p_location_id IS NULL THEN
    RAISE EXCEPTION 'agency_id and location_id parameters are required for tenant approval expiration';
  END IF;

  IF v_curr_agency IS NULL OR p_agency_id != v_curr_agency::uuid THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH: p_agency_id does not match current app.agency_id context';
  END IF;

  IF v_curr_location IS NOT NULL AND p_location_id != v_curr_location::uuid THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH: p_location_id does not match current app.location_id context';
  END IF;

  -- Atomic locked iteration scoped strictly to the validated agency and location
  FOR r IN
    SELECT a.id, a.agency_id, a.location_id, a.execution_id, a.node_id
    FROM workflow_approvals a
    WHERE a.agency_id = p_agency_id
      AND a.location_id = p_location_id
      AND a.status = 'pending'
      AND a.expires_at <= now()
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

-- Assign minimal grants and transfer ownership
REVOKE ALL ON FUNCTION expire_tenant_workflow_approvals(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_tenant_workflow_approvals(uuid, uuid) TO operza_app, operza_worker;
ALTER FUNCTION expire_tenant_workflow_approvals(uuid, uuid) OWNER TO operza_auth_definer;
