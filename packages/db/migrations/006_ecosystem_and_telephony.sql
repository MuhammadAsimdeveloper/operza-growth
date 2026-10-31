-- Migration 006: Ecosystem, Telephony, Developer Hub, AI Bot Training & White-Label Branding
-- Extends PostgreSQL schema with multi-tenant row-level security across all new domains

-- 1. Virtual Phone Numbers & IVR Routing
CREATE TABLE IF NOT EXISTS phone_numbers (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid,
  number text NOT NULL,
  label text NOT NULL CHECK (length(label) BETWEEN 2 AND 120),
  type text NOT NULL DEFAULT 'local' CHECK (type IN ('local', 'toll-free')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  assigned_to text NOT NULL,
  forward_to text,
  voice boolean NOT NULL DEFAULT true,
  sms boolean NOT NULL DEFAULT true,
  mms boolean NOT NULL DEFAULT false,
  ivr_enabled boolean NOT NULL DEFAULT false,
  ivr_menu text,
  recording_enabled boolean NOT NULL DEFAULT false,
  area_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, id)
);

CREATE INDEX IF NOT EXISTS phone_numbers_agency_idx ON phone_numbers(agency_id, status);

ALTER TABLE phone_numbers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'phone_numbers' AND policyname = 'phone_numbers_isolation_policy'
  ) THEN
    CREATE POLICY phone_numbers_isolation_policy ON phone_numbers
      AS RESTRICTIVE
      USING (agency_id = current_setting('app.current_agency_id', true)::uuid);
  END IF;
END $$;

-- 2. Developer Hub: Scoped API Keys
CREATE TABLE IF NOT EXISTS developer_keys (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  masked_key text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{"read"}'::text[],
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, id)
);

CREATE INDEX IF NOT EXISTS developer_keys_agency_idx ON developer_keys(agency_id, status);

ALTER TABLE developer_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'developer_keys' AND policyname = 'developer_keys_isolation_policy'
  ) THEN
    CREATE POLICY developer_keys_isolation_policy ON developer_keys
      AS RESTRICTIVE
      USING (agency_id = current_setting('app.current_agency_id', true)::uuid);
  END IF;
END $$;

-- 3. Developer Hub: Outbound Webhook Subscriptions
CREATE TABLE IF NOT EXISTS developer_webhooks (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  url text NOT NULL,
  events text[] NOT NULL DEFAULT '{"*"}'::text[],
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'failed')),
  secret_hash text,
  failure_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, id)
);

CREATE INDEX IF NOT EXISTS developer_webhooks_agency_idx ON developer_webhooks(agency_id, status);

ALTER TABLE developer_webhooks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'developer_webhooks' AND policyname = 'developer_webhooks_isolation_policy'
  ) THEN
    CREATE POLICY developer_webhooks_isolation_policy ON developer_webhooks
      AS RESTRICTIVE
      USING (agency_id = current_setting('app.current_agency_id', true)::uuid);
  END IF;
END $$;

-- 4. Developer Hub: Webhook Delivery Audit Ledger
CREATE TABLE IF NOT EXISTS developer_webhook_deliveries (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  webhook_id uuid NOT NULL,
  event_type text NOT NULL,
  endpoint_url text NOT NULL,
  http_status integer,
  latency_ms integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_body text,
  status text NOT NULL CHECK (status IN ('success', 'failure')),
  delivered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, id)
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_recent_idx ON developer_webhook_deliveries(agency_id, delivered_at DESC);

ALTER TABLE developer_webhook_deliveries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'developer_webhook_deliveries' AND policyname = 'webhook_deliveries_isolation_policy'
  ) THEN
    CREATE POLICY webhook_deliveries_isolation_policy ON developer_webhook_deliveries
      AS RESTRICTIVE
      USING (agency_id = current_setting('app.current_agency_id', true)::uuid);
  END IF;
END $$;

-- 5. AI Copilot: Semantic Knowledge Base Ingestion
CREATE TABLE IF NOT EXISTS ai_knowledge_base (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 255),
  source_type text NOT NULL DEFAULT 'text' CHECK (source_type IN ('text', 'pdf', 'url', 'faq', 'sop')),
  content text NOT NULL,
  chunks jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'indexing', 'ready', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, id)
);

CREATE INDEX IF NOT EXISTS ai_knowledge_base_agency_idx ON ai_knowledge_base(agency_id);

ALTER TABLE ai_knowledge_base ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_knowledge_base' AND policyname = 'ai_knowledge_isolation_policy'
  ) THEN
    CREATE POLICY ai_knowledge_isolation_policy ON ai_knowledge_base
      AS RESTRICTIVE
      USING (agency_id = current_setting('app.current_agency_id', true)::uuid);
  END IF;
END $$;

-- 6. AI Copilot: Bot Personality & Directive Configurations
CREATE TABLE IF NOT EXISTS ai_bot_configs (
  agency_id uuid PRIMARY KEY REFERENCES agencies(id) ON DELETE CASCADE,
  bot_name text NOT NULL DEFAULT 'Operza Copilot',
  persona text NOT NULL DEFAULT 'consultative_advisor',
  tone text NOT NULL DEFAULT 'professional',
  system_prompt text NOT NULL,
  temperature numeric(3,2) NOT NULL DEFAULT 0.70 CHECK (temperature BETWEEN 0.00 AND 1.00),
  capabilities jsonb NOT NULL DEFAULT '{"answerQuestions": true, "captureContacts": true, "scheduleMeetings": true}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_bot_configs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_bot_configs' AND policyname = 'ai_bot_configs_isolation_policy'
  ) THEN
    CREATE POLICY ai_bot_configs_isolation_policy ON ai_bot_configs
      AS RESTRICTIVE
      USING (agency_id = current_setting('app.current_agency_id', true)::uuid);
  END IF;
END $$;

-- 7. Agency White-Label & Custom Branding
CREATE TABLE IF NOT EXISTS agency_branding (
  agency_id uuid PRIMARY KEY REFERENCES agencies(id) ON DELETE CASCADE,
  platform_name text NOT NULL DEFAULT 'Operza Workspace',
  custom_domain text,
  is_domain_verified boolean NOT NULL DEFAULT false,
  ssl_active boolean NOT NULL DEFAULT false,
  cname_target text NOT NULL DEFAULT 'cname.operza.io',
  logo_url text,
  favicon_url text,
  primary_color text NOT NULL DEFAULT '#4f46e5',
  accent_color text NOT NULL DEFAULT '#6366f1',
  sender_name text NOT NULL DEFAULT 'Growth Operations Team',
  sender_email text NOT NULL DEFAULT 'hello@operza.io',
  is_dkim_verified boolean NOT NULL DEFAULT false,
  portal_welcome_heading text NOT NULL DEFAULT 'Welcome to Your Client Portal',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agency_branding ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'agency_branding' AND policyname = 'agency_branding_isolation_policy'
  ) THEN
    CREATE POLICY agency_branding_isolation_policy ON agency_branding
      AS RESTRICTIVE
      USING (agency_id = current_setting('app.current_agency_id', true)::uuid);
  END IF;
END $$;

-- 8. Global State Persistent Replicator
CREATE TABLE IF NOT EXISTS operza_app_state (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
