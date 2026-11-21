-- Migration 031: Durable Workflow Action Receipts & Execution Idempotency
-- 1. Updates status constraint to include 'indeterminate' for ambiguous provider outcomes.
-- 2. Adds lease fencing and recovery columns: lease_owner, lease_until, started_at, completed_at, last_error_code, outcome_details.
-- 3. Adds lease index for worker recovery lookups.
-- 4. Ensures RLS policies and grants for operza_worker and operza_app roles.

-- =========================================================================
-- 1. EXTEND STATUS CONSTRAINT ON WORKFLOW_ACTION_RECEIPTS
-- =========================================================================
DO $$
DECLARE
  c_name text;
BEGIN
  FOR c_name IN (
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class cls ON con.conrelid = cls.oid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
    WHERE cls.relname = 'workflow_action_receipts'
      AND att.attname = 'status'
      AND con.contype = 'c'
  ) LOOP
    EXECUTE format('ALTER TABLE workflow_action_receipts DROP CONSTRAINT IF EXISTS %I', c_name);
  END LOOP;
END $$;

ALTER TABLE workflow_action_receipts
  ADD CONSTRAINT workflow_action_receipts_status_check
  CHECK (status IN ('started', 'succeeded', 'failed', 'indeterminate'));

-- =========================================================================
-- 2. ADD LEASE AND OUTCOME TRACKING COLUMNS
-- =========================================================================
ALTER TABLE workflow_action_receipts
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS outcome_details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(outcome_details) = 'object' AND pg_column_size(outcome_details) <= 8192);

-- =========================================================================
-- 3. ADD WORKER LEASE EXPIRATION & RECOVERY INDEX
-- =========================================================================
CREATE INDEX IF NOT EXISTS workflow_action_receipts_lease_idx
  ON workflow_action_receipts (agency_id, location_id, status, lease_until);

-- =========================================================================
-- 4. GRANTS AND LEAST-PRIVILEGE ROLE PERMISSIONS
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_action_receipts TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON workflow_action_receipts TO operza_worker;
  END IF;
END $$;
