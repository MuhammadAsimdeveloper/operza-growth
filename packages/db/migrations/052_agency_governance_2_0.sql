-- Migration 052: Agency Workspace, Team Management & Access Governance 2.0
-- Extends agencies, locations, agency_memberships, agency_invitations, auth_sessions,
-- and adds agency_roles and user_location_memberships with FORCE ROW LEVEL SECURITY.

-- =========================================================================
-- 1. EXTEND AGENCIES FOR WORKSPACE PROFILE & ONBOARDING
-- =========================================================================
ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS address jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS default_language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS default_timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS default_currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS regional_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_state jsonb NOT NULL DEFAULT '{"completedSteps":[],"dismissed":false}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- =========================================================================
-- 2. EXTEND LOCATIONS FOR ARCHIVE/RESTORE & DETAILS
-- =========================================================================
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS address jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- =========================================================================
-- 3. AGENCY ROLES (BUILT-IN TEMPLATES & CUSTOM ROLES)
-- =========================================================================
CREATE TABLE IF NOT EXISTS agency_roles (
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  scope text NOT NULL DEFAULT 'agency' CHECK (scope IN ('agency', 'location')),
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_system boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, id),
  UNIQUE (agency_id, slug)
);

ALTER TABLE agency_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_roles_tenant_scope ON agency_roles;
CREATE POLICY agency_roles_tenant_scope ON agency_roles
  USING (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid)
  WITH CHECK (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid);

-- =========================================================================
-- 4. USER LOCATION MEMBERSHIPS
-- =========================================================================
CREATE TABLE IF NOT EXISTS user_location_memberships (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, user_id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

ALTER TABLE user_location_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_location_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_location_memberships_tenant_scope ON user_location_memberships;
CREATE POLICY user_location_memberships_tenant_scope ON user_location_memberships
  USING (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid)
  WITH CHECK (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid);

-- =========================================================================
-- 5. EXTEND MEMBERSHIPS, INVITATIONS & SESSIONS
-- =========================================================================
ALTER TABLE agency_memberships
  ADD COLUMN IF NOT EXISTS custom_role_id uuid,
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS offboarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS offboarded_by uuid;

ALTER TABLE agency_invitations
  DROP CONSTRAINT IF EXISTS agency_invitations_status_check;

ALTER TABLE agency_invitations
  ADD CONSTRAINT agency_invitations_status_check
  CHECK (status IN ('draft', 'pending', 'accepted', 'revoked', 'expired', 'declined'));

ALTER TABLE agency_invitations
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS location_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS custom_role_id uuid,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid,
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending_local'
    CHECK (delivery_status IN ('pending_local', 'sent_test_adapter', 'delivered', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS agency_invitations_token_hash_idx
  ON agency_invitations (token_hash)
  WHERE token_hash IS NOT NULL;

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

-- =========================================================================
-- 6. LEAST-PRIVILEGE ROLE GRANTS
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON agency_roles, user_location_memberships TO operza_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON agencies, locations, agency_memberships, agency_invitations, auth_sessions, agency_audit_events TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT ON agency_roles, user_location_memberships, agency_memberships TO operza_worker;
  END IF;
END $$;
