-- Migration 008: Provider governance, consent, durable workflow outbox, receipts, and commercial metering.
-- This schema is additive. It does not create provider credentials, enable live delivery, or charge customers.

ALTER TABLE workflow_executions
  DROP CONSTRAINT IF EXISTS workflow_executions_status_check;
ALTER TABLE workflow_executions
  ADD CONSTRAINT workflow_executions_status_check
  CHECK (status IN ('pending', 'running', 'resuming', 'waiting', 'waiting_approval', 'completed', 'failed', 'canceled', 'dead_letter'));

CREATE TABLE IF NOT EXISTS provider_connections (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid NOT NULL,
  provider_key text NOT NULL CHECK (provider_key IN ('email.sendgrid','email.resend','sms.twilio','whatsapp.meta_cloud','payments.stripe')),
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp','payments')),
  label text NOT NULL CHECK (length(label) BETWEEN 2 AND 100),
  secret_ref text NOT NULL CHECK (secret_ref ~ '^(env|vault|kms):[A-Za-z0-9_.:/-]{2,180}$'),
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object' AND pg_column_size(config) <= 8192),
  status text NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification','verified','degraded','revoked')),
  verification jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(verification) = 'object'),
  verified_at timestamptz,
  revoked_at timestamptz,
  last_check_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS provider_connections_lookup_idx ON provider_connections(agency_id, location_id, provider_key, status);

CREATE TABLE IF NOT EXISTS communication_consents (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  purpose text NOT NULL CHECK (purpose IN ('transactional','marketing','appointment','review_request')),
  status text NOT NULL CHECK (status IN ('granted','revoked')),
  source text NOT NULL CHECK (source IN ('web_form','api','keyword_opt_out','manual','import')),
  proof_ref text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS communication_consents_latest_idx
  ON communication_consents(agency_id, location_id, contact_id, channel, purpose, captured_at DESC);

CREATE TABLE IF NOT EXISTS workflow_approvals (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  node_id text NOT NULL CHECK (length(node_id) BETWEEN 1 AND 180),
  action_id text NOT NULL CHECK (length(action_id) BETWEEN 1 AND 180),
  action_hash text NOT NULL CHECK (action_hash ~ '^[a-f0-9]{64}$'),
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','canceled')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  request_checksum text NOT NULL CHECK (request_checksum ~ '^[a-f0-9]{64}$'),
  decision_checksum text CHECK (decision_checksum IS NULL OR decision_checksum ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, execution_id)
    REFERENCES workflow_executions(agency_id, location_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_approvals_one_pending_node_idx
  ON workflow_approvals(agency_id, location_id, execution_id, node_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS workflow_approvals_pending_idx
  ON workflow_approvals(agency_id, location_id, expires_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS workflow_action_receipts (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  node_id text NOT NULL,
  action_hash text NOT NULL CHECK (action_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','succeeded','failed')),
  provider_key text,
  provider_receipt text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object' AND pg_column_size(result) <= 8192),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, action_hash),
  FOREIGN KEY (agency_id, location_id, execution_id)
    REFERENCES workflow_executions(agency_id, location_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS workflow_action_receipts_status_idx ON workflow_action_receipts(agency_id, location_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS workflow_outbox (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  execution_id uuid,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{1,120}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 65536),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  priority smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN -10 AND 10),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','delivered','dead_letter','canceled')),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 25),
  last_error_code text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object' AND pg_column_size(result) <= 8192),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, idempotency_key),
  FOREIGN KEY (agency_id, location_id, execution_id)
    REFERENCES workflow_executions(agency_id, location_id, id) ON DELETE SET NULL,
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS workflow_outbox_available_idx
  ON workflow_outbox(priority DESC, available_at, created_at)
  WHERE status IN ('pending','leased');
CREATE INDEX IF NOT EXISTS workflow_outbox_tenant_recent_idx
  ON workflow_outbox(agency_id, location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_entitlements (
  agency_id uuid PRIMARY KEY REFERENCES agencies(id) ON DELETE CASCADE,
  plan_id text NOT NULL DEFAULT 'beta' CHECK (plan_id IN ('beta','studio','growth','enterprise')),
  feature_overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(feature_overrides) = 'object'),
  limit_overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(limit_overrides) = 'object'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','expired')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_events (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid,
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 8 AND 200),
  metric text NOT NULL CHECK (metric ~ '^[a-z][a-zA-Z0-9_.-]{1,80}$'),
  quantity bigint NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 2048),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, id),
  UNIQUE (agency_id, event_key),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE SET NULL (location_id)
);
CREATE INDEX IF NOT EXISTS usage_events_monthly_idx ON usage_events(agency_id, metric, occurred_at DESC);

-- Tenant-scoped RLS. These policies fail closed when tenant context is absent.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'provider_connections','communication_consents','workflow_approvals',
    'workflow_action_receipts','workflow_outbox','tenant_entitlements','usage_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_scope', table_name);
    IF table_name = 'tenant_entitlements' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (agency_id = nullif(current_setting(''app.agency_id'', true), '''')::uuid) WITH CHECK (agency_id = nullif(current_setting(''app.agency_id'', true), '''')::uuid)',
        table_name || '_tenant_scope', table_name
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (agency_id = nullif(current_setting(''app.agency_id'', true), '''')::uuid AND location_id = nullif(current_setting(''app.location_id'', true), '''')::uuid) WITH CHECK (agency_id = nullif(current_setting(''app.agency_id'', true), '''')::uuid AND location_id = nullif(current_setting(''app.location_id'', true), '''')::uuid)',
        table_name || '_tenant_scope', table_name
      );
    END IF;
  END LOOP;
END $$;

-- A separately provisioned operza_worker role may claim jobs across tenants.
-- Do not create this login or set its password in a migration. Provision it out-of-band.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON provider_connections, communication_consents,
      workflow_approvals, workflow_action_receipts, workflow_outbox,
      tenant_entitlements, usage_events TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, UPDATE ON workflow_outbox TO operza_worker;
    GRANT SELECT, INSERT, UPDATE ON workflow_action_receipts TO operza_worker;
    DROP POLICY IF EXISTS workflow_outbox_worker_scope ON workflow_outbox;
    CREATE POLICY workflow_outbox_worker_scope ON workflow_outbox TO operza_worker
      USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS workflow_action_receipts_worker_scope ON workflow_action_receipts;
    CREATE POLICY workflow_action_receipts_worker_scope ON workflow_action_receipts TO operza_worker
      USING (true) WITH CHECK (true);
  END IF;
END $$;
