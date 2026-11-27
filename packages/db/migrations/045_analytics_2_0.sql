-- Migration 045: Operza Analytics & Business Intelligence 2.0
-- Adds tenant-scoped analytics_saved_dashboards, analytics_saved_reports,
-- analytics_scheduled_reports, analytics_threshold_alerts, and analytics_events
-- with composite PKs, FORCE ROW LEVEL SECURITY, and operza_app/operza_worker grants.

-- 1. Saved Dashboards (private user vs agency-shared)
CREATE TABLE IF NOT EXISTS analytics_saved_dashboards (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  visibility text NOT NULL DEFAULT 'agency' CHECK (visibility IN ('private', 'agency')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  widgets_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

-- 2. Saved Custom Reports
CREATE TABLE IF NOT EXISTS analytics_saved_reports (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  visibility text NOT NULL DEFAULT 'agency' CHECK (visibility IN ('private', 'agency')),
  title text NOT NULL,
  data_source text NOT NULL,
  dimensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  measures jsonb NOT NULL DEFAULT '[]'::jsonb,
  filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  chart_type text NOT NULL DEFAULT 'table' CHECK (chart_type IN ('table', 'bar', 'line', 'donut', 'kpi', 'funnel')),
  date_range_days integer NOT NULL DEFAULT 30 CHECK (date_range_days BETWEEN 1 AND 3650),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

-- 3. Scheduled Reports (UTC + IANA timezone)
CREATE TABLE IF NOT EXISTS analytics_scheduled_reports (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  timezone text NOT NULL DEFAULT 'UTC',
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, report_id)
    REFERENCES analytics_saved_reports(agency_id, location_id, id) ON DELETE CASCADE
);

-- 4. Threshold Alerts
CREATE TABLE IF NOT EXISTS analytics_threshold_alerts (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  metric_id text NOT NULL,
  operator text NOT NULL CHECK (operator IN ('gt', 'gte', 'lt', 'lte')),
  threshold_value numeric NOT NULL,
  window_minutes integer NOT NULL DEFAULT 60 CHECK (window_minutes BETWEEN 5 AND 10080),
  cooldown_minutes integer NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 1 AND 10080),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'paused')),
  last_triggered_at timestamptz,
  acknowledged_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

-- 5. Idempotent Business Analytics Events
CREATE TABLE IF NOT EXISTS analytics_events (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  source_module text NOT NULL,
  source_record_id text,
  deduplication_key text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, source_module, deduplication_key),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analytics_events_type_time_idx
  ON analytics_events (agency_id, location_id, event_type, occurred_at DESC);

-- Enable & Force RLS
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'analytics_saved_dashboards',
    'analytics_saved_reports',
    'analytics_scheduled_reports',
    'analytics_threshold_alerts',
    'analytics_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_scope ON %I', tbl, tbl);
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
      tbl, tbl
    );
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      analytics_saved_dashboards, analytics_saved_reports, analytics_scheduled_reports,
      analytics_threshold_alerts, analytics_events
    TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      analytics_saved_dashboards, analytics_saved_reports, analytics_scheduled_reports,
      analytics_threshold_alerts, analytics_events
    TO operza_worker;
  END IF;
END $$;
