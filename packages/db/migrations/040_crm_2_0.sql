-- Product Advancement Stage 1: CRM 2.0
-- Adds crm_custom_field_defs, crm_smart_lists, crm_contact_merge_audit with FORCE RLS,
-- and indexed search paths on location_records for fast tenant-scoped contact lookup.

CREATE TABLE IF NOT EXISTS crm_custom_field_defs (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  field_key text NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  label text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'boolean', 'select', 'multi_select', 'url')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_custom_field_defs_key_idx
  ON crm_custom_field_defs (agency_id, location_id, field_key);

CREATE TABLE IF NOT EXISTS crm_smart_lists (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  filter_ast jsonb NOT NULL DEFAULT '{"op":"and","rules":[]}'::jsonb,
  created_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crm_contact_merge_audit (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  primary_contact_id uuid NOT NULL,
  merged_contact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  merged_by text NOT NULL DEFAULT 'system',
  snapshot_diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

-- Functional indexes on location_records for fast CRM contact search & duplicate lookup
CREATE INDEX IF NOT EXISTS location_records_contacts_email_idx
  ON location_records (agency_id, location_id, lower(body->>'email'))
  WHERE collection = 'contacts';

CREATE INDEX IF NOT EXISTS location_records_contacts_phone_idx
  ON location_records (agency_id, location_id, (body->>'phone'))
  WHERE collection = 'contacts';

DO $$
DECLARE
  tbl text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS location_records_contacts_search_trgm_idx ON location_records USING gin ((coalesce(body->>''firstName'','''') || '' '' || coalesce(body->>''lastName'','''') || '' '' || coalesce(body->>''company'','''')) gin_trgm_ops) WHERE collection = ''contacts''';
  END IF;

  FOREACH tbl IN ARRAY ARRAY[
    'crm_custom_field_defs',
    'crm_smart_lists',
    'crm_contact_merge_audit'
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
      crm_custom_field_defs, crm_smart_lists, crm_contact_merge_audit
    TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT ON crm_custom_field_defs, crm_smart_lists TO operza_worker;
  END IF;
END $$;
