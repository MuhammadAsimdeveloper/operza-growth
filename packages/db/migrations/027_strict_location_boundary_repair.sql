-- Migration 027: Strict Location-Boundary Repair for Tenant Approval Expiration
-- 1. Enforces mandatory non-null and non-empty app.location_id session context.
-- 2. Validates p_location_id argument is not null.
-- 3. Uses NULL-safe IS DISTINCT FROM comparison to strictly reject cross-location or missing context.
-- 4. Fails closed on malformed UUID session context.
-- 5. Preserves operza_auth_definer ownership and least-privilege grants.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_auth_definer') THEN
    RAISE EXCEPTION 'Required security role operza_auth_definer does not exist. Database bootstrap must provision this role.';
  END IF;

  IF NOT pg_has_role(current_user, 'operza_auth_definer', 'MEMBER') AND
     NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Migration runner "%" is not a member of operza_auth_definer. Grant membership during bootstrap.', current_user;
  END IF;
END $$;

-- Switch to operza_auth_definer to replace the function owned by operza_auth_definer
SET ROLE operza_auth_definer;

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
  v_curr_agency_str text;
  v_curr_location_str text;
  v_curr_agency uuid;
  v_curr_location uuid;
  r record;
BEGIN
  -- 1. Argument validation: both agency_id and location_id are strictly required
  IF p_agency_id IS NULL THEN
    RAISE EXCEPTION 'ARGUMENT_REQUIRED: p_agency_id parameter is required for tenant approval expiration';
  END IF;

  IF p_location_id IS NULL THEN
    RAISE EXCEPTION 'ARGUMENT_REQUIRED: p_location_id parameter is required for tenant approval expiration';
  END IF;

  -- 2. Context retrieval: both app.agency_id and app.location_id session settings are mandatory
  v_curr_agency_str := nullif(current_setting('app.agency_id', true), '');
  v_curr_location_str := nullif(current_setting('app.location_id', true), '');

  IF v_curr_agency_str IS NULL THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH: Missing active agency context (app.agency_id)';
  END IF;

  IF v_curr_location_str IS NULL THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH: Missing active location context (app.location_id)';
  END IF;

  -- 3. Safely parse UUID context (fails closed on malformed UUID strings)
  BEGIN
    v_curr_agency := v_curr_agency_str::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH: Malformed app.agency_id UUID context: %', v_curr_agency_str;
  END;

  BEGIN
    v_curr_location := v_curr_location_str::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH: Malformed app.location_id UUID context: %', v_curr_location_str;
  END;

  -- 4. NULL-safe strict equality comparison using IS DISTINCT FROM
  IF p_agency_id IS DISTINCT FROM v_curr_agency THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH: p_agency_id does not match current app.agency_id context';
  END IF;

  IF p_location_id IS DISTINCT FROM v_curr_location THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH: p_location_id does not match current app.location_id context';
  END IF;

  -- 5. Atomic locked iteration scoped strictly to the validated agency and location
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
    WHERE workflow_approvals.agency_id = p_agency_id
      AND workflow_approvals.location_id = p_location_id
      AND workflow_approvals.id = r.id;

    UPDATE workflow_executions
    SET status = 'failed',
        last_error_code = 'APPROVAL_EXPIRED',
        finished_at = now(),
        updated_at = now()
    WHERE workflow_executions.agency_id = p_agency_id
      AND workflow_executions.location_id = p_location_id
      AND workflow_executions.id = r.execution_id
      AND workflow_executions.status = 'waiting_approval';

    UPDATE workflow_execution_steps
    SET status = 'failed',
        error_code = 'APPROVAL_EXPIRED',
        finished_at = now()
    WHERE workflow_execution_steps.agency_id = p_agency_id
      AND workflow_execution_steps.location_id = p_location_id
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

REVOKE ALL ON FUNCTION expire_tenant_workflow_approvals(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_tenant_workflow_approvals(uuid, uuid) TO operza_app, operza_worker;

RESET ROLE;
