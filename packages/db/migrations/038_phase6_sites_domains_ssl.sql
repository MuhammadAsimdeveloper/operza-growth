-- Phase 6: Funnels/Sites V2 Versions, Custom Domains, SSL Certificates & Calendar V2 Rules
-- Enforces composite tenant PKs, FORCE ROW LEVEL SECURITY, global hostname uniqueness,
-- and least-privilege grants for operza_app and operza_worker.

CREATE TABLE IF NOT EXISTS site_versions (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  seo_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_by text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS site_versions_site_num_idx
  ON site_versions (agency_id, location_id, site_id, version_number);

CREATE TABLE IF NOT EXISTS custom_domains (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  site_id uuid,
  hostname text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN (
      'requested', 'pending_verification', 'verified', 'provisioning',
      'certificate_pending', 'active', 'failed', 'renewal_pending', 'disconnected'
    )),
  verification_token text NOT NULL,
  verification_expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

-- Prevent duplicate claims across tenants for any non-disconnected hostname
CREATE UNIQUE INDEX IF NOT EXISTS custom_domains_active_hostname_idx
  ON custom_domains (lower(hostname))
  WHERE status <> 'disconnected';

CREATE TABLE IF NOT EXISTS ssl_certificates (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  domain_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'acme_letsencrypt',
  status text NOT NULL DEFAULT 'provisioning_requested'
    CHECK (status IN (
      'provisioning_requested', 'domain_validation', 'issued', 'active',
      'renewal_scheduled', 'renewal_failed', 'expired', 'disconnected'
    )),
  issuer text,
  serial_number text,
  issued_at timestamptz,
  expires_at timestamptz,
  last_renewal_attempt_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, domain_id)
    REFERENCES custom_domains(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calendar_availability_rules (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  calendar_id uuid NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  buffer_before_min integer NOT NULL DEFAULT 0 CHECK (buffer_before_min >= 0),
  buffer_after_min integer NOT NULL DEFAULT 0 CHECK (buffer_after_min >= 0),
  min_notice_min integer NOT NULL DEFAULT 60 CHECK (min_notice_min >= 0),
  max_future_days integer NOT NULL DEFAULT 60 CHECK (max_future_days > 0),
  daily_limit integer CHECK (daily_limit IS NULL OR daily_limit > 0),
  weekly_windows jsonb NOT NULL DEFAULT '{}'::jsonb,
  time_off_blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_availability_rules_cal_idx
  ON calendar_availability_rules (agency_id, location_id, calendar_id);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'site_versions',
    'custom_domains',
    'ssl_certificates',
    'calendar_availability_rules'
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
      site_versions, custom_domains, ssl_certificates, calendar_availability_rules
    TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON
      site_versions, custom_domains, ssl_certificates, calendar_availability_rules
    TO operza_worker;
  END IF;
END $$;
