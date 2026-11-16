-- Migration 017: encrypted PKCE verifier and one-time tenant-bound OAuth state.
CREATE TABLE IF NOT EXISTS provider_oauth_states (
  state_hash char(64) PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  actor_id text NOT NULL,
  code_verifier_envelope text NOT NULL CHECK (code_verifier_envelope LIKE 'v1:%'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id,location_id) REFERENCES locations(agency_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS provider_oauth_states_expiry_idx ON provider_oauth_states(expires_at);
ALTER TABLE provider_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_oauth_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_oauth_states_tenant_scope ON provider_oauth_states;
CREATE POLICY provider_oauth_states_tenant_scope ON provider_oauth_states
  FOR ALL USING (
    agency_id=nullif(current_setting('app.agency_id',true),'')::uuid
    AND location_id=nullif(current_setting('app.location_id',true),'')::uuid
  ) WITH CHECK (
    agency_id=nullif(current_setting('app.agency_id',true),'')::uuid
    AND location_id=nullif(current_setting('app.location_id',true),'')::uuid
  );
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='operza_app') THEN
    GRANT SELECT,INSERT,DELETE ON provider_oauth_states TO operza_app;
  END IF;
END $$;
