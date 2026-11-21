-- Migration 029: Durable Workflow Resume Leases, Recovery & Webhook Ingress
-- 1. Adds resume_lease_owner, resume_lease_until, resume_started_at, and resume_token to workflow_executions.
-- 2. Adds recovery index for expired resume leases.
-- 3. Adds unique index for authoritative webhook resume token lookups.
-- 4. Creates security-definer helper for webhook token resolution across tenants.
-- 5. Preserves least-privilege role permissions for operza_app, operza_worker, and operza_auth_definer.

-- 1. Add resume lease and callback columns to workflow_executions
ALTER TABLE workflow_executions
  ADD COLUMN IF NOT EXISTS resume_lease_owner text,
  ADD COLUMN IF NOT EXISTS resume_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS resume_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS resume_token text;

-- 2. Index for resume lease recovery and worker claims
CREATE INDEX IF NOT EXISTS workflow_executions_resume_recovery_idx
  ON workflow_executions (status, resume_lease_until)
  WHERE status = 'resuming';

-- 3. Index for fast, authoritative webhook callback resolution
CREATE UNIQUE INDEX IF NOT EXISTS workflow_executions_resume_token_idx
  ON workflow_executions (resume_token)
  WHERE resume_token IS NOT NULL;

-- 4. Security-definer helper function to resolve execution by webhook resume token
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
SET search_path = public
STABLE
AS $$
  SELECT id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
         wait_generation, wait_type, retry_at, created_at
  FROM workflow_executions
  WHERE resume_token = p_token AND status = 'waiting_webhook'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION lookup_workflow_execution_by_resume_token(text) FROM PUBLIC;

-- 5. Role grants and ownership
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT EXECUTE ON FUNCTION lookup_workflow_execution_by_resume_token(text) TO operza_app;
    GRANT SELECT, INSERT, UPDATE ON workflow_executions TO operza_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT EXECUTE ON FUNCTION lookup_workflow_execution_by_resume_token(text) TO operza_worker;
    GRANT SELECT, INSERT, UPDATE ON workflow_executions TO operza_worker;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_auth_definer') THEN
    GRANT SELECT, UPDATE ON workflow_executions TO operza_auth_definer;
    IF pg_has_role(current_user, 'operza_auth_definer', 'MEMBER') THEN
      ALTER FUNCTION lookup_workflow_execution_by_resume_token(text) OWNER TO operza_auth_definer;
    END IF;
  END IF;
END $$;
