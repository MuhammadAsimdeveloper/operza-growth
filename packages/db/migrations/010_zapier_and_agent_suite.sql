-- ============================================================================
-- Migration: 010_zapier_and_agent_suite.sql
-- Subsystems: Zapier Integration & Multi-Agent Runtime Suite
-- ============================================================================

-- 1. Zapier Outbound Hook Subscriptions Registry
CREATE TABLE IF NOT EXISTS zapier_hook_subscriptions (
  id text PRIMARY KEY,
  agency_id text NOT NULL,
  location_id text NOT NULL,
  event text NOT NULL,
  target_url text NOT NULL,
  signing_secret text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated', 'cancelled')),
  consecutive_failures integer NOT NULL DEFAULT 0,
  deactivation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zapier_hooks_tenant_event 
  ON zapier_hook_subscriptions (agency_id, location_id, event, status);

-- 2. Zapier Outbound Deliveries Audit Log
CREATE TABLE IF NOT EXISTS zapier_hook_deliveries (
  id text PRIMARY KEY,
  subscription_id text NOT NULL REFERENCES zapier_hook_subscriptions (id) ON DELETE CASCADE,
  agency_id text NOT NULL,
  location_id text NOT NULL,
  event text NOT NULL,
  payload jsonb NOT NULL,
  http_status integer,
  response_body text,
  attempts integer NOT NULL DEFAULT 1,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zapier_deliveries_tenant 
  ON zapier_hook_deliveries (agency_id, created_at DESC);

-- 3. Multi-Agent Conversation Sessions
CREATE TABLE IF NOT EXISTS agent_conversation_sessions (
  id text PRIMARY KEY,
  agency_id text NOT NULL,
  location_id text NOT NULL,
  user_id text,
  visitor_fingerprint text,
  channel text NOT NULL DEFAULT 'copilot' CHECK (channel IN ('copilot', 'webchat', 'sms', 'whatsapp')),
  current_agent text NOT NULL DEFAULT 'supervisor',
  context_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_tenant 
  ON agent_conversation_sessions (agency_id, location_id, updated_at DESC);

-- 4. Multi-Agent Conversation Messages
CREATE TABLE IF NOT EXISTS agent_conversation_messages (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES agent_conversation_sessions (id) ON DELETE CASCADE,
  agency_id text NOT NULL,
  location_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  agent_id text,
  content text NOT NULL,
  tool_calls jsonb,
  tool_call_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session 
  ON agent_conversation_messages (session_id, created_at ASC);

-- 5. Multi-Agent Tool Invocations & Receipt Tracking
CREATE TABLE IF NOT EXISTS agent_tool_executions (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES agent_conversation_sessions (id) ON DELETE CASCADE,
  agency_id text NOT NULL,
  location_id text NOT NULL,
  agent_id text NOT NULL,
  tool_name text NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  proposal_id text,
  status text NOT NULL CHECK (status IN ('executed', 'proposal_created', 'failed', 'denied')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- ROW-LEVEL SECURITY ENFORCEMENT (Defense-in-Depth)
-- ============================================================================

ALTER TABLE zapier_hook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE zapier_hook_subscriptions FORCE ROW LEVEL SECURITY;

ALTER TABLE zapier_hook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE zapier_hook_deliveries FORCE ROW LEVEL SECURITY;

ALTER TABLE agent_conversation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_conversation_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE agent_conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_conversation_messages FORCE ROW LEVEL SECURITY;

ALTER TABLE agent_tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tool_executions FORCE ROW LEVEL SECURITY;

-- Subscriptions RLS
CREATE POLICY zapier_hook_subscriptions_tenant_isolation ON zapier_hook_subscriptions
  FOR ALL TO operza_app
  USING (agency_id = current_setting('app.agency_id', true) AND location_id = current_setting('app.location_id', true))
  WITH CHECK (agency_id = current_setting('app.agency_id', true) AND location_id = current_setting('app.location_id', true));

-- Deliveries RLS
CREATE POLICY zapier_hook_deliveries_tenant_isolation ON zapier_hook_deliveries
  FOR ALL TO operza_app
  USING (agency_id = current_setting('app.agency_id', true))
  WITH CHECK (agency_id = current_setting('app.agency_id', true));

-- Agent Sessions RLS
CREATE POLICY agent_sessions_tenant_isolation ON agent_conversation_sessions
  FOR ALL TO operza_app
  USING (agency_id = current_setting('app.agency_id', true) AND location_id = current_setting('app.location_id', true))
  WITH CHECK (agency_id = current_setting('app.agency_id', true) AND location_id = current_setting('app.location_id', true));

-- Agent Messages RLS
CREATE POLICY agent_messages_tenant_isolation ON agent_conversation_messages
  FOR ALL TO operza_app
  USING (agency_id = current_setting('app.agency_id', true) AND location_id = current_setting('app.location_id', true))
  WITH CHECK (agency_id = current_setting('app.agency_id', true) AND location_id = current_setting('app.location_id', true));

-- Agent Tool Executions RLS
CREATE POLICY agent_tool_executions_tenant_isolation ON agent_tool_executions
  FOR ALL TO operza_app
  USING (agency_id = current_setting('app.agency_id', true) AND location_id = current_setting('app.location_id', true))
  WITH CHECK (agency_id = current_setting('app.agency_id', true) AND location_id = current_setting('app.location_id', true));
