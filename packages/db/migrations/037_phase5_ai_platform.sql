-- Phase 5: Real AI Infrastructure (RAG, Agents, Tool Calls, Usage Governance, Evals & Voice Sessions)
-- Enforces composite tenant PKs, FORCE ROW LEVEL SECURITY, and least-privilege grants.
-- Conditionally enables pgvector when installed in the PostgreSQL distribution, while
-- preserving full PostgreSQL array + pg_trgm hybrid retrieval when pgvector binary is absent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  file_type text NOT NULL DEFAULT 'text',
  size_bytes integer NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  checksum text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'deleted')),
  chunks_count integer NOT NULL DEFAULT 0 CHECK (chunks_count >= 0),
  words_count integer NOT NULL DEFAULT 0 CHECK (words_count >= 0),
  ingestion_version integer NOT NULL DEFAULT 1,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_knowledge_sources_status_idx
  ON ai_knowledge_sources (agency_id, location_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content text NOT NULL,
  token_count integer NOT NULL DEFAULT 0 CHECK (token_count >= 0),
  start_offset integer NOT NULL DEFAULT 0 CHECK (start_offset >= 0),
  end_offset integer NOT NULL DEFAULT 0 CHECK (end_offset >= 0),
  heading text,
  page_number integer,
  embedding_model text NOT NULL DEFAULT 'operza-trigram-v1',
  embedding_version text NOT NULL DEFAULT '1',
  embedding_dim integer NOT NULL DEFAULT 64,
  embedding_vector double precision[] NOT NULL,
  ingestion_version integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, source_id)
    REFERENCES ai_knowledge_sources(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_source_idx
  ON ai_knowledge_chunks (agency_id, location_id, source_id, chunk_index);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_content_trgm_idx ON ai_knowledge_chunks USING gin (content gin_trgm_ops)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'ALTER TABLE ai_knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_pgvector vector(1536)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ai_agents (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  persona text NOT NULL DEFAULT 'executive',
  system_prompt text NOT NULL DEFAULT '',
  provider text NOT NULL DEFAULT 'gemini',
  model text NOT NULL DEFAULT 'gemini-1.5-flash',
  temperature numeric(3, 2) NOT NULL DEFAULT 0.40,
  max_steps integer NOT NULL DEFAULT 6 CHECK (max_steps > 0 AND max_steps <= 25),
  max_tokens_per_run integer NOT NULL DEFAULT 4096 CHECK (max_tokens_per_run > 0),
  allowed_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  knowledge_base_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  guardrails jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'disabled')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_runs (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid,
  user_id text,
  session_id text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'budget_exceeded', 'cancelled', 'awaiting_approval')),
  steps_count integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_microcents bigint NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  error_code text,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_tool_calls (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  tool_name text NOT NULL,
  risk_level text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('allowed', 'proposal_required', 'denied', 'executed', 'failed')),
  approval_id text,
  input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, run_id)
    REFERENCES ai_runs(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text,
  agent_id uuid,
  run_id uuid,
  provider text NOT NULL,
  model text NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('chat', 'embedding', 'tool', 'voice')),
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  embedding_tokens integer NOT NULL DEFAULT 0,
  voice_seconds integer NOT NULL DEFAULT 0,
  estimated_cost_microcents bigint NOT NULL DEFAULT 0,
  actual_provider_cost_microcents bigint,
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'blocked_budget', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_usage_events_period_idx
  ON ai_usage_events (agency_id, location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_eval_runs (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  dataset_version text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL DEFAULT '1.0.0',
  tools_version text NOT NULL DEFAULT '1.0.0',
  passed boolean NOT NULL DEFAULT false,
  total_cases integer NOT NULL DEFAULT 0,
  passed_cases integer NOT NULL DEFAULT 0,
  failed_cases integer NOT NULL DEFAULT 0,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  gate_failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_voice_sessions (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid,
  user_id text,
  contact_id text,
  provider text NOT NULL DEFAULT 'twilio_media_streams',
  status text NOT NULL DEFAULT 'authorized' CHECK (status IN ('authorized', 'streaming', 'interrupted', 'ended', 'cancelled', 'expired')),
  consent_verified boolean NOT NULL DEFAULT false,
  recording_permitted boolean NOT NULL DEFAULT false,
  transcription_permitted boolean NOT NULL DEFAULT false,
  duration_seconds integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ai_knowledge_sources',
    'ai_knowledge_chunks',
    'ai_agents',
    'ai_runs',
    'ai_tool_calls',
    'ai_usage_events',
    'ai_eval_runs',
    'ai_voice_sessions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_scope ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant_scope ON %I USING (agency_id = nullif(current_setting(''app.agency_id'', true), '''')::uuid AND location_id = nullif(current_setting(''app.location_id'', true), '''')::uuid) WITH CHECK (agency_id = nullif(current_setting(''app.agency_id'', true), '''')::uuid AND location_id = nullif(current_setting(''app.location_id'', true), '''')::uuid)',
      tbl, tbl
    );
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      ai_knowledge_sources, ai_knowledge_chunks, ai_agents, ai_runs,
      ai_tool_calls, ai_usage_events, ai_eval_runs, ai_voice_sessions
    TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON
      ai_knowledge_sources, ai_knowledge_chunks, ai_agents, ai_runs,
      ai_tool_calls, ai_usage_events, ai_eval_runs, ai_voice_sessions
    TO operza_worker;
  END IF;
END $$;
