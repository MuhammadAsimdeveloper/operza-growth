-- Product Advancement Stage 12: Customer Portal & Self-Service 2.0
-- Enforces composite tenant PKs, hashed single-use magic links, agency-scoped
-- customer sessions, self-service request governance, and FORCE ROW LEVEL SECURITY.

CREATE TABLE IF NOT EXISTS customer_portal_configs (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false,
  portal_name text NOT NULL DEFAULT 'Customer Portal',
  welcome_message text NOT NULL DEFAULT 'Welcome to your client portal.',
  support_email text,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowed_features jsonb NOT NULL DEFAULT '{"appointments":true,"messages":true,"orders":true,"invoices":true,"documents":true,"preferences":true}'::jsonb,
  editable_profile_fields jsonb NOT NULL DEFAULT '["firstName","lastName","phone","company","timezone","preferredLanguage"]'::jsonb,
  custom_domain_id uuid,
  updated_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_portal_magic_links (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL,
  email text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (token_hash),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_portal_sessions (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL,
  session_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (session_token_hash),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_portal_requests (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL,
  request_type text NOT NULL CHECK (
    request_type IN (
      'profile_update', 'booking_change', 'support_ticket',
      'invoice_correction', 'order_cancellation', 'refund_review',
      'account_closure', 'data_export'
    )
  ),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'completed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_portal_events (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL,
  event_type text NOT NULL CHECK (
    event_type IN (
      'portal_sign_in', 'profile_update', 'appointment_request',
      'appointment_change', 'conversation_started', 'invoice_viewed',
      'document_downloaded', 'payment_link_visited', 'self_service_request'
    )
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS portal_requests_contact_idx
  ON customer_portal_requests (agency_id, location_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_events_contact_idx
  ON customer_portal_events (agency_id, location_id, contact_id, occurred_at DESC);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customer_portal_configs',
    'customer_portal_magic_links',
    'customer_portal_sessions',
    'customer_portal_requests',
    'customer_portal_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_scope ON %I', t, t);
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
      t, t
    );
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      customer_portal_configs,
      customer_portal_magic_links,
      customer_portal_sessions,
      customer_portal_requests,
      customer_portal_events
    TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON
      customer_portal_configs,
      customer_portal_magic_links,
      customer_portal_sessions,
      customer_portal_requests,
      customer_portal_events
    TO operza_worker;
  END IF;
END $$;
