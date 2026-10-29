CREATE TABLE IF NOT EXISTS agencies (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agency_memberships (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  PRIMARY KEY (agency_id,id),
  UNIQUE (agency_id,user_id)
);
CREATE INDEX IF NOT EXISTS agency_memberships_user_idx ON agency_memberships(user_id, status);

CREATE TABLE IF NOT EXISTS locations (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  timezone text NOT NULL DEFAULT 'UTC',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id,id)
);

CREATE TABLE IF NOT EXISTS agency_invitations (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','member','viewer')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  invited_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  PRIMARY KEY (agency_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS agency_invitation_pending_email_idx
  ON agency_invitations(agency_id, lower(email)) WHERE status='pending';

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS location_records (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  collection text NOT NULL CHECK (collection ~ '^[a-z][a-z0-9_]{0,39}$'),
  body jsonb NOT NULL CHECK (jsonb_typeof(body)='object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id,location_id,collection,id),
  FOREIGN KEY (agency_id,location_id) REFERENCES locations(agency_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS location_records_lookup_idx ON location_records(agency_id,location_id,collection,updated_at DESC);
CREATE INDEX IF NOT EXISTS location_records_body_search_idx ON location_records USING gin(body jsonb_path_ops);

CREATE TABLE IF NOT EXISTS agency_audit_events (
  id uuid NOT NULL,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource text NOT NULL,
  resource_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id,id),
  FOREIGN KEY (agency_id,location_id) REFERENCES locations(agency_id,id) ON DELETE SET NULL (location_id)
);
CREATE INDEX IF NOT EXISTS agency_audit_events_recent_idx ON agency_audit_events(agency_id,created_at DESC);

-- Tenant-bound tables fail closed when an application transaction has no tenant context.
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agencies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agencies_tenant_scope ON agencies;
CREATE POLICY agencies_tenant_scope ON agencies USING (id = nullif(current_setting('app.agency_id',true),'')::uuid)
  WITH CHECK (id = nullif(current_setting('app.agency_id',true),'')::uuid);

ALTER TABLE agency_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memberships_user_or_agency_scope ON agency_memberships;
CREATE POLICY memberships_user_or_agency_scope ON agency_memberships
  USING (user_id = nullif(current_setting('app.user_id',true),'')::uuid OR agency_id = nullif(current_setting('app.agency_id',true),'')::uuid)
  WITH CHECK (agency_id = nullif(current_setting('app.agency_id',true),'')::uuid);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS locations_tenant_scope ON locations;
CREATE POLICY locations_tenant_scope ON locations USING (agency_id = nullif(current_setting('app.agency_id',true),'')::uuid)
  WITH CHECK (agency_id = nullif(current_setting('app.agency_id',true),'')::uuid);

ALTER TABLE agency_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_invitations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invitations_tenant_scope ON agency_invitations;
CREATE POLICY invitations_tenant_scope ON agency_invitations USING (agency_id = nullif(current_setting('app.agency_id',true),'')::uuid)
  WITH CHECK (agency_id = nullif(current_setting('app.agency_id',true),'')::uuid);

ALTER TABLE location_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS location_records_tenant_scope ON location_records;
CREATE POLICY location_records_tenant_scope ON location_records
  USING (agency_id = nullif(current_setting('app.agency_id',true),'')::uuid AND location_id = nullif(current_setting('app.location_id',true),'')::uuid)
  WITH CHECK (agency_id = nullif(current_setting('app.agency_id',true),'')::uuid AND location_id = nullif(current_setting('app.location_id',true),'')::uuid);

ALTER TABLE agency_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_tenant_scope ON agency_audit_events;
CREATE POLICY audit_tenant_scope ON agency_audit_events USING (agency_id = nullif(current_setting('app.agency_id',true),'')::uuid)
  WITH CHECK (agency_id = nullif(current_setting('app.agency_id',true),'')::uuid);

-- Auth tables are accessed only by the private application role; add tenant/user policies before
-- granting direct table access to any separately deployed service.

