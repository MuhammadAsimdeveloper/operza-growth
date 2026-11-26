-- Phase 7: SaaS Subscriptions, Marketplace, OAuth 2.0 Apps & Platform Admin Audit
-- Enforces composite tenant PKs, FORCE ROW LEVEL SECURITY, hashed secrets/tokens,
-- and least-privilege grants for operza_app and operza_worker.

CREATE TABLE IF NOT EXISTS saas_subscriptions (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  plan_id text NOT NULL DEFAULT 'beta',
  status text NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired')),
  seat_limit integer NOT NULL DEFAULT 3 CHECK (seat_limit >= 1),
  location_limit integer NOT NULL DEFAULT 2 CHECK (location_limit >= 1),
  trial_ends_at timestamptz,
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz,
  grace_period_ends_at timestamptz,
  stripe_subscription_id text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS saas_subscriptions_tenant_idx
  ON saas_subscriptions (agency_id, location_id);

CREATE TABLE IF NOT EXISTS marketplace_apps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  publisher_id text NOT NULL,
  category text NOT NULL DEFAULT 'automation',
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'approved', 'published', 'suspended', 'deprecated', 'removed')),
  version text NOT NULL DEFAULT '1.0.0',
  connector_id text,
  requested_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_installations (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
  installed_by text NOT NULL,
  granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'installed'
    CHECK (status IN ('installed', 'configured', 'connected', 'disabled', 'uninstalled')),
  connection_id uuid,
  installed_at timestamptz NOT NULL DEFAULT now(),
  uninstalled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_apps (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_id text NOT NULL UNIQUE,
  client_secret_hash text NOT NULL,
  client_secret_prefix text NOT NULL,
  redirect_uris jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL,
  user_id text NOT NULL,
  code_hash text NOT NULL UNIQUE,
  redirect_uri text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  code_challenge text,
  code_challenge_method text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, app_id) REFERENCES oauth_apps(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL,
  user_id text NOT NULL,
  access_token_hash text NOT NULL UNIQUE,
  refresh_token_hash text NOT NULL UNIQUE,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, app_id) REFERENCES oauth_apps(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS platform_admin_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason text,
  result text NOT NULL DEFAULT 'success',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'saas_subscriptions',
    'marketplace_installations',
    'oauth_apps',
    'oauth_auth_codes',
    'oauth_tokens'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_scope ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant_scope ON %I USING (agency_id = nullif(current_setting(''app.agency_id'', true), '''')::uuid AND location_id = nullif(current_setting(''app.location_id'', true), '''')::uuid) WITH CHECK (agency_id = nullif(current_setting(''app.agency_id'', true), '''')::uuid AND location_id = nullif(current_setting(''app.location_id'', true), '''')::uuid)',
      tbl, tbl
    );
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      saas_subscriptions, marketplace_installations, oauth_apps, oauth_auth_codes, oauth_tokens
    TO operza_app;
    GRANT SELECT ON marketplace_apps TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, UPDATE ON saas_subscriptions, marketplace_installations TO operza_worker;
  END IF;
END $$;
