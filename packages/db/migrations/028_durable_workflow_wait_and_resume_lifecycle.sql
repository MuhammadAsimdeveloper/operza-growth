-- Migration 028: Durable Workflow Wait & Resume Lifecycle
-- 1. Updates workflow execution status constraints to include 'enqueued' and 'waiting_webhook'.
-- 2. Adds wait_generation, workflow_version, workflow_snapshot, resume_node_id, and wait_type to workflow_executions.
-- 3. Updates workflow_execution_steps status constraints to include 'waiting' and 'waiting_webhook'.
-- 4. Creates index for fast scheduled waiting resumption lookups.
-- 5. Preserves least-privilege role permissions for operza_app, operza_worker, and operza_auth_definer.

-- 1. Update workflow_executions status check
ALTER TABLE workflow_executions
  DROP CONSTRAINT IF EXISTS workflow_executions_status_check;

ALTER TABLE workflow_executions
  ADD CONSTRAINT workflow_executions_status_check
  CHECK (status IN (
    'pending',
    'enqueued',
    'running',
    'resuming',
    'waiting',
    'waiting_approval',
    'waiting_webhook',
    'completed',
    'failed',
    'canceled',
    'dead_letter'
  ));

-- 2. Add lifecycle tracking columns to workflow_executions
ALTER TABLE workflow_executions
  ADD COLUMN IF NOT EXISTS wait_generation integer NOT NULL DEFAULT 0;

ALTER TABLE workflow_executions
  ADD COLUMN IF NOT EXISTS workflow_version integer NOT NULL DEFAULT 1;

ALTER TABLE workflow_executions
  ADD COLUMN IF NOT EXISTS workflow_snapshot jsonb;

ALTER TABLE workflow_executions
  ADD COLUMN IF NOT EXISTS resume_node_id text;

ALTER TABLE workflow_executions
  ADD COLUMN IF NOT EXISTS wait_type text
  CHECK (wait_type IS NULL OR wait_type IN ('timed', 'approval', 'webhook'));

-- 3. Update workflow_execution_steps status check
ALTER TABLE workflow_execution_steps
  DROP CONSTRAINT IF EXISTS workflow_execution_steps_status_check;

ALTER TABLE workflow_execution_steps
  ADD CONSTRAINT workflow_execution_steps_status_check
  CHECK (status IN (
    'running',
    'completed',
    'failed',
    'waiting',
    'waiting_approval',
    'waiting_webhook',
    'skipped'
  ));

-- 4. Add index for scheduled waiting recovery / inspection
CREATE INDEX IF NOT EXISTS workflow_executions_waiting_retry_idx
  ON workflow_executions (agency_id, location_id, retry_at)
  WHERE status = 'waiting';

-- 5. Ensure proper least-privilege grants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE ON workflow_executions, workflow_execution_steps TO operza_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON workflow_executions, workflow_execution_steps TO operza_worker;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_auth_definer') THEN
    GRANT SELECT, UPDATE ON workflow_executions, workflow_execution_steps TO operza_auth_definer;
  END IF;
END $$;
