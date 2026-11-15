-- Migration 016: tenant-scoped encrypted provider secrets and Microsoft Graph connector.
-- Ciphertext only is stored here; encryption/decryption remains in the API process.

ALTER TABLE provider_connections
  DROP CONSTRAINT IF EXISTS provider_connections_provider_key_check;
ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_provider_key_check
  CHECK (provider_key IN (
    'email.sendgrid',
    'email.resend',
    'email.microsoft_graph',
    'sms.twilio',
    'whatsapp.meta_cloud',
    'payments.stripe'
  ));

CREATE TABLE IF NOT EXISTS provider_secrets (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  secret_name text NOT NULL CHECK (secret_name ~ '^[A-Za-z0-9_.-]{2,120}$'),
  encrypted_value text NOT NULL CHECK (encrypted_value ~ '^v1:[a-fA-F0-9:]+$' AND length(encrypted_value) <= 100000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, secret_name),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_secrets_updated_idx
  ON provider_secrets(agency_id, location_id, updated_at DESC);

ALTER TABLE provider_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_secrets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_secrets_tenant_scope ON provider_secrets;
CREATE POLICY provider_secrets_tenant_scope ON provider_secrets
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON provider_secrets TO operza_app;
  END IF;
END $$;
