-- Migration 032: Action Receipt Claim Token & Ownership Fencing
-- 1. Adds unique per-attempt claim_token to workflow_action_receipts.
-- 2. Adds partial index for active leased receipt fencing.
-- 3. Ensures least-privilege role permissions on the updated table.

-- =========================================================================
-- 1. ADD CLAIM_TOKEN COLUMN
-- =========================================================================
ALTER TABLE workflow_action_receipts
  ADD COLUMN IF NOT EXISTS claim_token text;

-- =========================================================================
-- 2. ADD CLAIM TOKEN FENCING INDEX
-- =========================================================================
CREATE INDEX IF NOT EXISTS workflow_action_receipts_claim_fencing_idx
  ON workflow_action_receipts (agency_id, location_id, action_hash, claim_token, lease_until)
  WHERE status = 'started';

-- =========================================================================
-- 3. ENSURE LEAST-PRIVILEGE ROLE PERMISSIONS
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
