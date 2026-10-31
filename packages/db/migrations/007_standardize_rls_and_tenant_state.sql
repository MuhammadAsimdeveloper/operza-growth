-- Migration 007: Standardize PostgreSQL Row-Level Security, Tenant Context & Agency-Scoped Persistence
-- Enforces fail-closed RLS policies across all tenant tables
-- Replaces global unscoped application state with tenant-isolated persistence

-- 1. Standardize Policies on Core Tables
DO $$ BEGIN
  -- Core Tables RLS Re-enforcement
  ALTER TABLE IF EXISTS agencies ENABLE ROW LEVEL SECURITY;
  ALTER TABLE IF EXISTS agencies FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS agencies_tenant_scope ON agencies;
  CREATE POLICY agencies_tenant_scope ON agencies
    USING (id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid)
    WITH CHECK (id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid);

  ALTER TABLE IF EXISTS locations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE IF EXISTS locations FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS locations_tenant_scope ON locations;
  CREATE POLICY locations_tenant_scope ON locations
    USING (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid)
    WITH CHECK (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid);

  ALTER TABLE IF EXISTS location_records ENABLE ROW LEVEL SECURITY;
  ALTER TABLE IF EXISTS location_records FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS location_records_tenant_scope ON location_records;
  CREATE POLICY location_records_tenant_scope ON location_records
    USING (
      agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid
      AND (
        nullif(coalesce(current_setting('app.current_location_id', true), current_setting('app.location_id', true)), '') IS NULL
        OR location_id = nullif(coalesce(current_setting('app.current_location_id', true), current_setting('app.location_id', true)), '')::uuid
      )
    )
    WITH CHECK (
      agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid
      AND (
        nullif(coalesce(current_setting('app.current_location_id', true), current_setting('app.location_id', true)), '') IS NULL
        OR location_id = nullif(coalesce(current_setting('app.current_location_id', true), current_setting('app.location_id', true)), '')::uuid
      )
    );

  ALTER TABLE IF EXISTS workflow_definitions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE IF EXISTS workflow_definitions FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS workflow_definitions_tenant_scope ON workflow_definitions;
  CREATE POLICY workflow_definitions_tenant_scope ON workflow_definitions
    USING (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid)
    WITH CHECK (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid);

  ALTER TABLE IF EXISTS workflow_executions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE IF EXISTS workflow_executions FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS workflow_executions_tenant_scope ON workflow_executions;
  CREATE POLICY workflow_executions_tenant_scope ON workflow_executions
    USING (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid)
    WITH CHECK (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid);

  ALTER TABLE IF EXISTS workflow_execution_steps ENABLE ROW LEVEL SECURITY;
  ALTER TABLE IF EXISTS workflow_execution_steps FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS workflow_execution_steps_tenant_scope ON workflow_execution_steps;
  CREATE POLICY workflow_execution_steps_tenant_scope ON workflow_execution_steps
    USING (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid)
    WITH CHECK (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid);

  ALTER TABLE IF EXISTS phone_numbers ENABLE ROW LEVEL SECURITY;
  ALTER TABLE IF EXISTS phone_numbers FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS phone_numbers_isolation_policy ON phone_numbers;
  DROP POLICY IF EXISTS phone_numbers_tenant_scope ON phone_numbers;
  CREATE POLICY phone_numbers_tenant_scope ON phone_numbers
    USING (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid)
    WITH CHECK (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid);

  ALTER TABLE IF EXISTS developer_keys ENABLE ROW LEVEL SECURITY;
  ALTER TABLE IF EXISTS developer_keys FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS developer_keys_isolation_policy ON developer_keys;
  DROP POLICY IF EXISTS developer_keys_tenant_scope ON developer_keys;
  CREATE POLICY developer_keys_tenant_scope ON developer_keys
    USING (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid)
    WITH CHECK (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid);

  ALTER TABLE IF EXISTS developer_webhooks ENABLE ROW LEVEL SECURITY;
  ALTER TABLE IF EXISTS developer_webhooks FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS developer_webhooks_isolation_policy ON developer_webhooks;
  DROP POLICY IF EXISTS developer_webhooks_tenant_scope ON developer_webhooks;
  CREATE POLICY developer_webhooks_tenant_scope ON developer_webhooks
    USING (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid)
    WITH CHECK (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid);

  ALTER TABLE IF EXISTS agency_snapshots ENABLE ROW LEVEL SECURITY;
  ALTER TABLE IF EXISTS agency_snapshots FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS agency_snapshots_isolation_policy ON agency_snapshots;
  DROP POLICY IF EXISTS agency_snapshots_tenant_scope ON agency_snapshots;
  CREATE POLICY agency_snapshots_tenant_scope ON agency_snapshots
    USING (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid)
    WITH CHECK (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid);
END $$;

-- 2. First-Class Relational CRM Tables with Forced RLS
CREATE TABLE IF NOT EXISTS contacts (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'lead',
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, id)
);
CREATE INDEX IF NOT EXISTS contacts_agency_email_idx ON contacts(agency_id, email);
CREATE INDEX IF NOT EXISTS contacts_agency_phone_idx ON contacts(agency_id, phone);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_tenant_scope ON contacts;
CREATE POLICY contacts_tenant_scope ON contacts
  USING (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid)
  WITH CHECK (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  priority text NOT NULL DEFAULT 'medium',
  due_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, id)
);
CREATE INDEX IF NOT EXISTS tasks_agency_status_idx ON tasks(agency_id, status);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tasks_tenant_scope ON tasks;
CREATE POLICY tasks_tenant_scope ON tasks
  USING (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid)
  WITH CHECK (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid);

CREATE TABLE IF NOT EXISTS opportunities (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid,
  name text NOT NULL,
  stage text NOT NULL DEFAULT 'lead',
  value numeric(14,2) NOT NULL DEFAULT 0.00,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, id)
);
CREATE INDEX IF NOT EXISTS opportunities_agency_stage_idx ON opportunities(agency_id, stage);

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS opportunities_tenant_scope ON opportunities;
CREATE POLICY opportunities_tenant_scope ON opportunities
  USING (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid)
  WITH CHECK (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid);

-- 3. Replace Global Unscoped Application State with Agency-Scoped Persistence
CREATE TABLE IF NOT EXISTS agency_tenant_states (
  agency_id uuid PRIMARY KEY REFERENCES agencies(id) ON DELETE CASCADE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_tenant_states_agency_idx ON agency_tenant_states(agency_id, updated_at DESC);

ALTER TABLE agency_tenant_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_tenant_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_tenant_states_tenant_scope ON agency_tenant_states;
CREATE POLICY agency_tenant_states_tenant_scope ON agency_tenant_states
  USING (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid)
  WITH CHECK (agency_id = nullif(coalesce(current_setting('app.current_agency_id', true), current_setting('app.agency_id', true)), '')::uuid);

-- 4. Grant Permissions to Application Role (if role exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO operza_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO operza_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON opportunities TO operza_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON agency_tenant_states TO operza_app;
  END IF;
END $$;
