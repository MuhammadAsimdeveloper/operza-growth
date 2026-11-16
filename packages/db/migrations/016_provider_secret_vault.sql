-- Migration 016: Tenant-isolated encrypted provider secret storage.
-- Values in this table must be versioned AES-GCM envelopes, never plaintext.
CREATE TABLE IF NOT EXISTS provider_secrets (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  secret_ref text NOT NULL CHECK (secret_ref LIKE 'vault:%' AND length(secret_ref) BETWEEN 80 AND 240),
  encrypted_value text NOT NULL CHECK (encrypted_value LIKE 'v1:%' AND length(encrypted_value) <= 65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, secret_ref),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_secrets_tenant_idx
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
