-- Migration 030: Harden Workflow Resume Leases, Outbox Recovery & Callback Ingress
-- 1. Adds recovery_epoch column to workflow_executions for tracking recovery attempts.
-- 2. Validates operza_auth_definer role and membership (fails loudly if missing).
-- 3. Hardens lookup_workflow_execution_by_resume_token with secure search_path (pg_catalog, public, pg_temp).
-- 4. Schema-qualifies all table references (public.workflow_executions).
-- 5. Enforces strict ownership by operza_auth_definer, revokes PUBLIC execute, and grants to operza_app and operza_worker.

-- =========================================================================
-- 1. ADD RECOVERY_EPOCH TO WORKFLOW_EXECUTIONS
-- =========================================================================
ALTER TABLE workflow_executions
  ADD COLUMN IF NOT EXISTS recovery_epoch integer NOT NULL DEFAULT 0;

-- =========================================================================
-- 2. VALIDATE DEFINER ROLE & MIGRATION RUNNER MEMBERSHIP (FAIL CLOSED)
-- =========================================================================
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

-- Verify operza_auth_definer privileges on workflow_executions
GRANT SELECT, UPDATE ON public.workflow_executions TO operza_auth_definer;

-- Switch to operza_auth_definer to replace the function owned by operza_auth_definer
SET ROLE operza_auth_definer;

-- =========================================================================
-- 3. HARDENED SECURITY DEFINER FUNCTION FOR WEBHOOK RESUME TOKEN RESOLUTION
-- =========================================================================
CREATE OR REPLACE FUNCTION lookup_workflow_execution_by_resume_token(p_token text)
RETURNS TABLE (
  id uuid,
  agency_id uuid,
  location_id uuid,
  workflow_id uuid,
  status text,
  current_node_id text,
  resume_node_id text,
  wait_generation integer,
  wait_type text,
  retry_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
STABLE
AS $$
  SELECT id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
         wait_generation, wait_type, retry_at, created_at
  FROM public.workflow_executions
  WHERE resume_token = p_token AND status = 'waiting_webhook'
  LIMIT 1;
$$;

-- Enforce ownership and least-privilege execute permissions
ALTER FUNCTION lookup_workflow_execution_by_resume_token(text) OWNER TO operza_auth_definer;
REVOKE ALL ON FUNCTION lookup_workflow_execution_by_resume_token(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT EXECUTE ON FUNCTION lookup_workflow_execution_by_resume_token(text) TO operza_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT EXECUTE ON FUNCTION lookup_workflow_execution_by_resume_token(text) TO operza_worker;
  END IF;
END $$;

RESET ROLE;
