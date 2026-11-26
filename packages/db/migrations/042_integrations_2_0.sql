-- Migration 042: Operza Integrations Hub 2.0
-- Adds tenant-scoped integration_connections, integration_webhook_endpoints,
-- integration_webhook_events, integration_sync_jobs, and integration_sync_conflicts
-- with composite PKs, FORCE ROW LEVEL SECURITY, and operza_app/operza_worker grants.

-- 1. Integration Connections (zero plaintext tokens; only vault_secret_ref)
CREATE TABLE IF NOT EXISTS integration_connections (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connector_id text NOT NULL,
  provider text NOT NULL,
  account_label text NOT NULL DEFAULT '',
  external_account_id text,
  auth_strategy text NOT NULL CHECK (auth_strategy IN ('oauth2_pkce', 'api_key', 'basic', 'signed_secret', 'webhook_secret')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'paused', 'expired', 'revoked', 'disconnected', 'error')),
  readiness_level text NOT NULL DEFAULT 'implemented_adapter'
    CHECK (readiness_level IN ('implemented_adapter', 'unit_tested', 'sandbox_verified', 'production_configured', 'live_verified')),
  vault_secret_ref text CHECK (vault_secret_ref IS NULL OR vault_secret_ref ~ '^(vault|kms):[A-Za-z0-9_.:/-]{2,180}$'),
  granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_expires_at timestamptz,
  last_tested_at timestamptz,
  last_error_code text,
  circuit_state text NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed', 'open', 'half_open')),
  failure_count integer NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS integration_connections_connector_idx
  ON integration_connections (agency_id, location_id, connector_id, status);

-- 2. Webhook Endpoints (Inbound & Outbound)
CREATE TABLE IF NOT EXISTS integration_webhook_endpoints (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  provider text NOT NULL,
  target_url text,
  signing_secret_ref text,
  event_subscriptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  failure_count integer NOT NULL DEFAULT 0,
  circuit_open_until timestamptz,
  last_delivery_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

-- 3. Durable Normalized Webhook Events
CREATE TABLE IF NOT EXISTS integration_webhook_events (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  direction text NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  schema_version integer NOT NULL DEFAULT 1,
  normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_state text NOT NULL DEFAULT 'received'
    CHECK (processing_state IN ('received', 'normalized', 'delivered', 'failed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  correlation_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, provider, provider_event_id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS integration_webhook_events_state_idx
  ON integration_webhook_events (agency_id, location_id, processing_state, received_at DESC);

-- 4. Data Synchronization Jobs & External Mappings
CREATE TABLE IF NOT EXISTS integration_sync_jobs (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  entity_type text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('one_way_inbound', 'one_way_outbound', 'two_way')),
  sync_mode text NOT NULL DEFAULT 'incremental' CHECK (sync_mode IN ('initial', 'incremental', 'manual')),
  conflict_policy text NOT NULL DEFAULT 'source_priority'
    CHECK (conflict_policy IN ('source_priority', 'timestamp_wins', 'manual_queue')),
  field_mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'completed', 'failed', 'paused')),
  records_processed integer NOT NULL DEFAULT 0,
  records_failed integer NOT NULL DEFAULT 0,
  cursor text,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, connection_id)
    REFERENCES integration_connections(agency_id, location_id, id) ON DELETE CASCADE
);

-- 5. Sync Conflict Queue
CREATE TABLE IF NOT EXISTS integration_sync_conflicts (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sync_job_id uuid NOT NULL,
  local_record_id text NOT NULL,
  external_record_id text NOT NULL,
  local_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved_local', 'resolved_external', 'ignored')),
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, sync_job_id)
    REFERENCES integration_sync_jobs(agency_id, location_id, id) ON DELETE CASCADE
);

-- Enable & Force RLS on all 5 tables
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'integration_connections',
    'integration_webhook_endpoints',
    'integration_webhook_events',
    'integration_sync_jobs',
    'integration_sync_conflicts'
  ]
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

-- Least-privilege grants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      integration_connections,
      integration_webhook_endpoints,
      integration_webhook_events,
      integration_sync_jobs,
      integration_sync_conflicts
    TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      integration_connections,
      integration_webhook_endpoints,
      integration_webhook_events,
      integration_sync_jobs,
      integration_sync_conflicts
    TO operza_worker;
  END IF;
END $$;
