-- Migration 005: Agency Snapshots Engine
-- Reusable workspace template bundles with multi-tenant row-level security

CREATE TABLE IF NOT EXISTS agency_snapshots (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  source_location_id uuid,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  description text,
  industry text NOT NULL DEFAULT 'General',
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, id)
);

CREATE INDEX IF NOT EXISTS agency_snapshots_agency_idx ON agency_snapshots(agency_id, created_at DESC);

ALTER TABLE agency_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'agency_snapshots' AND policyname = 'agency_snapshots_isolation_policy'
  ) THEN
    CREATE POLICY agency_snapshots_isolation_policy ON agency_snapshots
      AS RESTRICTIVE
      USING (agency_id = current_setting('app.current_agency_id', true)::uuid);
  END IF;
END $$;
