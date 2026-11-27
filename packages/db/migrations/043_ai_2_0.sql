-- Migration 043: Operza AI Automation & Agents 2.0
-- Adds tenant- and user-scoped ai_agent_memories, persisted ai_agent_plans,
-- and bounded ai_delegations with FORCE ROW LEVEL SECURITY.

-- 1. Controlled Agent Memory (separates user-private vs agency-shared memory)
CREATE TABLE IF NOT EXISTS ai_agent_memories (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('user', 'agency')),
  user_id text,
  agent_id uuid,
  memory_key text NOT NULL,
  content text NOT NULL,
  consent_granted boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_agent_memories_lookup_idx
  ON ai_agent_memories (agency_id, location_id, scope, user_id, expires_at);

-- 2. Validated Agent Execution Plans
CREATE TABLE IF NOT EXISTS ai_agent_plans (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  objective text NOT NULL,
  steps_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  dependencies_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_classification text NOT NULL DEFAULT 'low' CHECK (risk_classification IN ('low', 'medium', 'high')),
  validated boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'running', 'completed', 'failed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, run_id) REFERENCES ai_runs(agency_id, location_id, id) ON DELETE CASCADE
);

-- 3. Bounded Multi-Agent Delegations
CREATE TABLE IF NOT EXISTS ai_delegations (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  parent_run_id uuid NOT NULL,
  child_run_id uuid,
  parent_agent_id uuid,
  specialist_type text NOT NULL,
  depth integer NOT NULL CHECK (depth >= 1 AND depth <= 3),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, parent_run_id) REFERENCES ai_runs(agency_id, location_id, id) ON DELETE CASCADE
);

-- Enable & Force RLS
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['ai_agent_memories', 'ai_agent_plans', 'ai_delegations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_scope ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant_scope ON %I
       USING (
         agency_id = nullif(current_setting(''app.agency_id'', true), '''')::uuid
         AND location_id = nullif(current_setting(''app.location_id'', true), '''')::uuid
       )
       WITH CHECK (
         agency_id = nullif(current_setting(''app.agency_id'', true), '''')::uuid
         AND location_id = nullif(current_setting(''app.location_id'', true), '''')::uuid
       )',
      tbl, tbl
    );
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_agent_memories, ai_agent_plans, ai_delegations TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_agent_memories, ai_agent_plans, ai_delegations TO operza_worker;
  END IF;
END $$;
