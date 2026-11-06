-- Migration 009: Copilot proposals, review and execution boundary.
-- Approval of a proposal records a human decision only. Execution is a separate future operation.

CREATE TABLE IF NOT EXISTS copilot_proposals (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  tool_name text NOT NULL CHECK (tool_name ~ '^[a-z][a-z0-9_]{1,80}$'),
  params jsonb NOT NULL CHECK (jsonb_typeof(params) = 'object' AND pg_column_size(params) <= 12288),
  risk text NOT NULL CHECK (risk IN ('write','workflow','external_side_effect')),
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','rejected','canceled')),
  requires_human_approval boolean NOT NULL DEFAULT true CHECK (requires_human_approval = true),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  review_note text CHECK (review_note IS NULL OR length(review_note) <= 500),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS copilot_proposals_review_idx
  ON copilot_proposals(agency_id, location_id, status, created_at DESC);

ALTER TABLE copilot_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS copilot_proposals_tenant_scope ON copilot_proposals;
CREATE POLICY copilot_proposals_tenant_scope ON copilot_proposals
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE ON copilot_proposals TO operza_app;
  END IF;
END $$;
