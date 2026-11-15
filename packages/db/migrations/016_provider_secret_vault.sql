-- Migration 016: Tenant-scoped encrypted provider secret envelopes.
-- Plaintext credentials must never be persisted in this table.

CREATE TABLE IF NOT EXISTS provider_secret_vault (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  secret_ref text NOT NULL CHECK (secret_ref ~ '^vault:[A-Za-z0-9_.:/-]{2,180}$'),
  encrypted_value text NOT NULL CHECK (encrypted_value LIKE 'v1:%' AND length(encrypted_value) BETWEEN 20 AND 32768),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, secret_ref),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_secret_vault_scope_idx
  ON provider_secret_vault(agency_id, location_id);

ALTER TABLE provider_secret_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_secret_vault FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_secret_vault_tenant_scope ON provider_secret_vault;
CREATE POLICY provider_secret_vault_tenant_scope ON provider_secret_vault
  FOR ALL TO operza_app
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON provider_secret_vault TO operza_app;
  END IF;
END $$;
