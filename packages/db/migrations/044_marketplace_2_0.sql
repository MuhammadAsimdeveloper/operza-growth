-- Migration 044: Operza Marketplace & Developer Ecosystem 2.0
-- Extends Phase 7 marketplace_apps and marketplace_installations additively
-- with marketplace_publishers, marketplace_app_releases, marketplace_app_reviews,
-- and marketplace_analytics_events.

-- 1. Extend marketplace_apps & marketplace_installations additively
ALTER TABLE marketplace_apps
  ADD COLUMN IF NOT EXISTS app_type text NOT NULL DEFAULT 'external_connector'
    CHECK (app_type IN (
      'native_integration', 'external_connector', 'workflow_extension',
      'ai_agent_extension', 'ai_tool', 'reporting_extension',
      'business_template', 'workflow_template', 'automation_package'
    )),
  ADD COLUMN IF NOT EXISTS pricing_model text NOT NULL DEFAULT 'free'
    CHECK (pricing_model IN ('free', 'one_time', 'subscription', 'usage_based', 'freemium')),
  ADD COLUMN IF NOT EXISTS price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'usd',
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

ALTER TABLE marketplace_apps
  DROP CONSTRAINT IF EXISTS marketplace_apps_status_check;

ALTER TABLE marketplace_apps
  ADD CONSTRAINT marketplace_apps_status_check
  CHECK (status IN (
    'draft', 'submitted', 'under_review', 'changes_requested',
    'approved', 'published', 'suspended', 'rejected', 'deprecated', 'removed', 'archived'
  ));

ALTER TABLE marketplace_installations
  ADD COLUMN IF NOT EXISTS installed_version text NOT NULL DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_upgraded_at timestamptz;

ALTER TABLE marketplace_installations
  DROP CONSTRAINT IF EXISTS marketplace_installations_status_check;

ALTER TABLE marketplace_installations
  ADD CONSTRAINT marketplace_installations_status_check
  CHECK (status IN (
    'pending', 'installed', 'configured', 'connected', 'active',
    'permission_update_required', 'connection_required', 'paused',
    'uninstalling', 'uninstalled', 'disabled', 'revoked'
  ));

-- 2. Publishers
CREATE TABLE IF NOT EXISTS marketplace_publishers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id text NOT NULL,
  display_name text NOT NULL,
  organization_name text NOT NULL DEFAULT '',
  support_email text NOT NULL,
  website_url text,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'suspended')),
  terms_accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_publishers_owner_idx
  ON marketplace_publishers (owner_user_id);

-- 3. Immutable App Releases (SemVer)
CREATE TABLE IF NOT EXISTS marketplace_app_releases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  app_id uuid NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
  version text NOT NULL,
  release_channel text NOT NULL DEFAULT 'stable' CHECK (release_channel IN ('dev', 'testing', 'stable', 'deprecated', 'archived')),
  compatibility_min text NOT NULL DEFAULT '2.0.0',
  release_notes text NOT NULL DEFAULT '',
  requested_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  security_review_status text NOT NULL DEFAULT 'pending'
    CHECK (security_review_status IN ('pending', 'approved', 'changes_requested', 'rejected')),
  reviewed_by text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, version)
);

-- 4. Verified Installation Reviews (TenantTx + FORCE RLS for tenant-owned write)
CREATE TABLE IF NOT EXISTS marketplace_app_reviews (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  reviewer_user_id text NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text NOT NULL DEFAULT '',
  verified_installation boolean NOT NULL DEFAULT true,
  publisher_reply text,
  moderation_status text NOT NULL DEFAULT 'published'
    CHECK (moderation_status IN ('published', 'flagged', 'hidden', 'removed')),
  moderated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, app_id, reviewer_user_id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

ALTER TABLE marketplace_app_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_app_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_app_reviews_tenant_scope ON marketplace_app_reviews;
CREATE POLICY marketplace_app_reviews_tenant_scope ON marketplace_app_reviews
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- 5. Marketplace Analytics Events
CREATE TABLE IF NOT EXISTS marketplace_analytics_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  app_id uuid NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('listing_view', 'install_attempt', 'install_success', 'uninstall', 'execution_ok', 'execution_error')),
  version text,
  agency_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_analytics_app_idx
  ON marketplace_analytics_events (app_id, event_type, created_at DESC);

-- Grants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      marketplace_publishers, marketplace_app_releases, marketplace_app_reviews, marketplace_analytics_events
    TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON
      marketplace_publishers, marketplace_app_releases, marketplace_app_reviews, marketplace_analytics_events
    TO operza_worker;
  END IF;
END $$;
