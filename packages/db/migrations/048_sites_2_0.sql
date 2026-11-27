-- Product Advancement Stage 11: Website, Landing Page & Funnel Builder 2.0
-- Enforces composite tenant PKs, FORCE ROW LEVEL SECURITY, and least-privilege grants.

CREATE TABLE IF NOT EXISTS sites_2 (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'publishing', 'published', 'publish_failed', 'archived')),
  homepage_page_id uuid,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  navigation jsonb NOT NULL DEFAULT '[]'::jsonb,
  seo_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_version_id uuid,
  published_version_number integer,
  version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1),
  created_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, slug),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS site_pages_2 (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  schema_version integer NOT NULL DEFAULT 2 CHECK (schema_version >= 1),
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  seo_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  nav_visible boolean NOT NULL DEFAULT true,
  no_index boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, site_id, slug),
  FOREIGN KEY (agency_id, location_id, site_id)
    REFERENCES sites_2(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS site_starter_templates (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  description text NOT NULL DEFAULT '',
  schema_version integer NOT NULL DEFAULT 2,
  pages_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS site_media_assets (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL,
  scan_status text NOT NULL DEFAULT 'quarantined'
    CHECK (scan_status IN ('uploaded', 'quarantined', 'scanned_clean', 'infected', 'published')),
  alt_text text NOT NULL DEFAULT '',
  usage_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS site_conversion_events (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  site_id uuid,
  funnel_id uuid,
  page_id uuid,
  event_type text NOT NULL CHECK (
    event_type IN (
      'page_view', 'landing_view', 'form_view', 'form_start', 'form_submit',
      'booking_start', 'booking_complete', 'cta_click', 'step_progress', 'conversion'
    )
  ),
  dedup_key text NOT NULL,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, dedup_key),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS site_pages_2_site_idx
  ON site_pages_2 (agency_id, location_id, site_id);
CREATE INDEX IF NOT EXISTS site_conversion_events_lookup_idx
  ON site_conversion_events (agency_id, location_id, site_id, event_type, occurred_at DESC);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sites_2',
    'site_pages_2',
    'site_starter_templates',
    'site_media_assets',
    'site_conversion_events'
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
      sites_2,
      site_pages_2,
      site_starter_templates,
      site_media_assets,
      site_conversion_events
    TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON
      sites_2,
      site_pages_2,
      site_starter_templates,
      site_media_assets,
      site_conversion_events
    TO operza_worker;
  END IF;
END $$;
