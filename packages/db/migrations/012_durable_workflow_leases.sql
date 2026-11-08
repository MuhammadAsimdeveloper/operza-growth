-- Migration 012: Durable Workflow Leases, Definition Hashes & Abandoned Job Recovery
-- Scoped to Agency & Location with Forced Row-Level Security

-- 1. Definition hash for deterministic template and definition version pinning
ALTER TABLE workflow_definitions
  ADD COLUMN IF NOT EXISTS definition_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE workflow_templates
  ADD COLUMN IF NOT EXISTS definition_hash VARCHAR(64);

-- 2. Durable execution leases, heartbeat tracking, and attempt counters
ALTER TABLE workflow_executions
  ADD COLUMN IF NOT EXISTS worker_lease_id TEXT,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3;

-- 3. Queue and recovery index for rapid worker claiming and dead lease resumption
CREATE INDEX IF NOT EXISTS workflow_executions_lease_recovery_idx
  ON workflow_executions (status, lease_expires_at)
  WHERE status IN ('pending', 'running', 'resuming');

CREATE INDEX IF NOT EXISTS workflow_executions_active_lease_idx
  ON workflow_executions (agency_id, location_id, worker_lease_id)
  WHERE worker_lease_id IS NOT NULL;
