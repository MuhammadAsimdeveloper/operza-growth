-- Migration 003: Durable Workflow Definitions & Executions Engine
-- Scoped to Agency & Location with Forced PostgreSQL Row-Level Security

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 150),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused', 'archived')),
  trigger_type text NOT NULL CHECK (trigger_type IN ('form', 'tag', 'appointment', 'opportunity_stage', 'invoice', 'payment', 'webhook', 'schedule', 'manual')),
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  nodes jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS workflow_definitions_location_idx ON workflow_definitions(agency_id, location_id, status);

CREATE TABLE IF NOT EXISTS workflow_executions (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'waiting', 'waiting_approval', 'completed', 'failed', 'canceled', 'dead_letter')),
  trigger_event jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_node_id text,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_checksum text,
  leased_by text,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, workflow_id) REFERENCES workflow_definitions(agency_id, location_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS workflow_executions_queue_idx ON workflow_executions(status, retry_at) WHERE status IN ('pending', 'running', 'waiting');

CREATE TABLE IF NOT EXISTS workflow_execution_steps (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  node_id text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'waiting_approval', 'skipped')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, execution_id) REFERENCES workflow_executions(agency_id, location_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS workflow_steps_exec_idx ON workflow_execution_steps(agency_id, location_id, execution_id, started_at DESC);

-- Enable & Force Row-Level Security
ALTER TABLE workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_definitions_tenant_scope ON workflow_definitions;
CREATE POLICY workflow_definitions_tenant_scope ON workflow_definitions
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_executions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_executions_tenant_scope ON workflow_executions;
CREATE POLICY workflow_executions_tenant_scope ON workflow_executions
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

ALTER TABLE workflow_execution_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_execution_steps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_execution_steps_tenant_scope ON workflow_execution_steps;
CREATE POLICY workflow_execution_steps_tenant_scope ON workflow_execution_steps
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- Grant access to application role
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_definitions TO operza_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_executions TO operza_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_execution_steps TO operza_app;
  END IF;
END $$;
