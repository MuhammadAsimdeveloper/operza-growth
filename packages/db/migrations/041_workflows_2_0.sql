-- Migration 041: Operza Workflow Builder & Execution Engine 2.0
-- Adds immutable workflow_versions, timezone-aware workflow_schedules,
-- structured workflow_execution_logs, and additive workflow_definitions columns.
-- All tables enforce composite tenant PKs, FORCE ROW LEVEL SECURITY, and
-- least-privilege grants for operza_app and operza_worker.

-- 1. Extend workflow_definitions with V2 graph, description, governance, and published pointer
ALTER TABLE workflow_definitions
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS published_version_id uuid,
  ADD COLUMN IF NOT EXISTS graph_json jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS governance_policy jsonb NOT NULL DEFAULT '{"maxNodes":200,"maxSteps":500,"maxLoopIterations":100,"maxParallelBranches":10,"maxDurationMs":300000,"maxPayloadBytes":262144,"maxRetries":3,"maxQueuedExecutions":100}'::jsonb,
  ADD COLUMN IF NOT EXISTS draft_updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE workflow_definitions
  DROP CONSTRAINT IF EXISTS workflow_definitions_trigger_type_check;

ALTER TABLE workflow_definitions
  ADD CONSTRAINT workflow_definitions_trigger_type_check
  CHECK (trigger_type IN (
    'form', 'tag', 'appointment', 'opportunity_stage',
    'invoice', 'payment', 'webhook', 'schedule', 'manual',
    'contact_created', 'contact_updated', 'contact_tag_changed',
    'opportunity_created', 'conversation_event', 'integration_event',
    'workflow_error'
  ));

-- 2. Immutable Workflow Versions
CREATE TABLE IF NOT EXISTS workflow_versions (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'superseded', 'rolled_back')),
  trigger_type text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  nodes jsonb NOT NULL DEFAULT '[]'::jsonb,
  graph_json jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  governance_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum text NOT NULL,
  change_summary text NOT NULL DEFAULT '',
  published_by text,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, workflow_id, version_number),
  FOREIGN KEY (agency_id, location_id, workflow_id)
    REFERENCES workflow_definitions(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS workflow_versions_lookup_idx
  ON workflow_versions (agency_id, location_id, workflow_id, version_number DESC);

ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_versions_tenant_scope ON workflow_versions;
CREATE POLICY workflow_versions_tenant_scope ON workflow_versions
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- 3. Timezone-Aware Workflow Schedules (UTC persistence + IANA timezone)
CREATE TABLE IF NOT EXISTS workflow_schedules (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL,
  schedule_type text NOT NULL CHECK (schedule_type IN ('once', 'interval', 'cron')),
  timezone text NOT NULL DEFAULT 'UTC',
  cron_expression text,
  interval_every integer CHECK (interval_every IS NULL OR (interval_every >= 1 AND interval_every <= 10080)),
  interval_unit text CHECK (interval_unit IS NULL OR interval_unit IN ('minutes', 'hours', 'days')),
  run_at timestamptz,
  next_run_at timestamptz,
  last_run_at timestamptz,
  catchup_policy text NOT NULL DEFAULT 'skip'
    CHECK (catchup_policy IN ('skip', 'run_once', 'catch_up')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed')),
  run_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, workflow_id)
    REFERENCES workflow_definitions(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS workflow_schedules_due_idx
  ON workflow_schedules (agency_id, location_id, next_run_at)
  WHERE status = 'active';

ALTER TABLE workflow_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_schedules_tenant_scope ON workflow_schedules;
CREATE POLICY workflow_schedules_tenant_scope ON workflow_schedules
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- 4. Redacted Structured Execution Logs
CREATE TABLE IF NOT EXISTS workflow_execution_logs (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL,
  node_id text,
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error')),
  event_type text NOT NULL,
  message text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, execution_id)
    REFERENCES workflow_executions(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS workflow_execution_logs_exec_idx
  ON workflow_execution_logs (agency_id, location_id, execution_id, created_at ASC);

ALTER TABLE workflow_execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_execution_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_execution_logs_tenant_scope ON workflow_execution_logs;
CREATE POLICY workflow_execution_logs_tenant_scope ON workflow_execution_logs
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- 5. Least-Privilege Role Grants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_versions, workflow_schedules, workflow_execution_logs TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_versions, workflow_schedules, workflow_execution_logs TO operza_worker;
  END IF;
END $$;
