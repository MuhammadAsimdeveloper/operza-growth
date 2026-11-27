-- Migration 050: Workflow Execution Operations & Reliability 2.0
-- Extends workflow_executions, workflow_execution_steps, and adds
-- durable workflow_execution_attempts with composite tenant keys,
-- FORCE ROW LEVEL SECURITY, tenant-aware indexes, and least-privilege grants.

-- =========================================================================
-- 1. EXTEND WORKFLOW_EXECUTIONS STATUS & OPERATIONS COLUMNS
-- =========================================================================
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
    'retry_scheduled',
    'completed',
    'failed',
    'canceled',
    'dead_letter'
  ));

ALTER TABLE workflow_executions
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS trigger_type text,
  ADD COLUMN IF NOT EXISTS workflow_name text,
  ADD COLUMN IF NOT EXISTS failure_category text,
  ADD COLUMN IF NOT EXISTS failure_message text,
  ADD COLUMN IF NOT EXISTS retryable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retry_policy jsonb NOT NULL DEFAULT '{"maxAttempts":3,"baseDelayMs":5000,"maxDelayMs":300000,"jitter":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS parent_execution_id uuid,
  ADD COLUMN IF NOT EXISTS root_execution_id uuid,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS total_nodes_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_nodes_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_nodes_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_requested_by text,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz,
  ADD COLUMN IF NOT EXISTS dead_letter_reason text,
  ADD COLUMN IF NOT EXISTS requeued_at timestamptz,
  ADD COLUMN IF NOT EXISTS requeued_by text,
  ADD COLUMN IF NOT EXISTS requeue_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS workflow_executions_ops_list_idx
  ON workflow_executions (agency_id, location_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS workflow_executions_ops_wf_idx
  ON workflow_executions (agency_id, location_id, workflow_id, created_at DESC);

CREATE INDEX IF NOT EXISTS workflow_executions_ops_failure_idx
  ON workflow_executions (agency_id, location_id, failure_category)
  WHERE failure_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS workflow_executions_dlq_idx
  ON workflow_executions (agency_id, location_id, dead_lettered_at DESC)
  WHERE status = 'dead_letter';

CREATE INDEX IF NOT EXISTS workflow_executions_retry_sched_idx
  ON workflow_executions (agency_id, location_id, next_retry_at)
  WHERE status = 'retry_scheduled';

-- =========================================================================
-- 2. EXTEND WORKFLOW_EXECUTION_STEPS FOR NODE OBSERVABILITY
-- =========================================================================
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
    'skipped',
    'canceled'
  ));

ALTER TABLE workflow_execution_steps
  ADD COLUMN IF NOT EXISTS node_type text,
  ADD COLUMN IF NOT EXISTS node_name text,
  ADD COLUMN IF NOT EXISTS execution_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS output_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS failure_category text,
  ADD COLUMN IF NOT EXISTS preceding_node_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS correlation_id text;

CREATE INDEX IF NOT EXISTS workflow_steps_order_idx
  ON workflow_execution_steps (agency_id, location_id, execution_id, execution_order ASC, started_at ASC);

-- =========================================================================
-- 3. DURABLE WORKFLOW EXECUTION ATTEMPTS (RETRY LINEAGE)
-- =========================================================================
CREATE TABLE IF NOT EXISTS workflow_execution_attempts (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL CHECK (status IN (
    'pending', 'enqueued', 'running', 'retry_scheduled',
    'completed', 'failed', 'canceled', 'dead_letter'
  )),
  failure_category text,
  error_code text,
  error_message text,
  retryable boolean NOT NULL DEFAULT false,
  worker_lease_id text,
  triggered_by text,
  retry_reason text,
  correlation_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, execution_id, attempt_number),
  FOREIGN KEY (agency_id, location_id, execution_id)
    REFERENCES workflow_executions(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS workflow_execution_attempts_lookup_idx
  ON workflow_execution_attempts (agency_id, location_id, execution_id, attempt_number ASC);

ALTER TABLE workflow_execution_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_execution_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_execution_attempts_tenant_scope ON workflow_execution_attempts;
CREATE POLICY workflow_execution_attempts_tenant_scope ON workflow_execution_attempts
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- =========================================================================
-- 4. LEAST-PRIVILEGE ROLE GRANTS
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_execution_attempts TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON workflow_execution_attempts TO operza_worker;
  END IF;
END $$;
