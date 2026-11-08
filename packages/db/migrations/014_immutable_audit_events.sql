-- Migration 014: Immutable Audit Trail & Hash-Chained Events
-- Scoped to Agency & Location with Forced PostgreSQL Row-Level Security & Tamper Proofing

CREATE TABLE IF NOT EXISTS immutable_audit_events (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  actor_id text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'copilot_agent', 'workflow_worker', 'system_cron', 'api_key')),
  event_name text NOT NULL CHECK (length(event_name) BETWEEN 3 AND 120),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_ip text,
  user_agent text,
  event_hash varchar(64) NOT NULL,
  prev_hash varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS immutable_audit_timeline_idx
  ON immutable_audit_events (agency_id, location_id, created_at DESC);

CREATE INDEX IF NOT EXISTS immutable_audit_event_name_idx
  ON immutable_audit_events (agency_id, location_id, event_name);

-- Immutability enforcement: Block UPDATE and DELETE on audit trail
CREATE OR REPLACE RULE immutable_audit_no_update AS
  ON UPDATE TO immutable_audit_events
  DO INSTEAD NOTHING;

CREATE OR REPLACE RULE immutable_audit_no_delete AS
  ON DELETE TO immutable_audit_events
  DO INSTEAD NOTHING;

-- Enable and force Row-Level Security
ALTER TABLE immutable_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE immutable_audit_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS immutable_audit_events_tenant_scope ON immutable_audit_events;
CREATE POLICY immutable_audit_events_tenant_scope ON immutable_audit_events
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );
