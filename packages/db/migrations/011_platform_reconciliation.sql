-- ============================================================================
-- Migration 011: Platform Reconciliation & Core CRM Entity Formalization
-- ============================================================================
-- Enforces Row-Level Security across all historical tables, creates normalized
-- CRM relational tables for pipelines, stages, opportunities, calendars, and
-- appointments, with strict composite (agency_id, location_id) multi-tenant scoping.

-- 1. Ensure RLS is enabled and forced on core tenant identity tables
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agencies FORCE ROW LEVEL SECURITY;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_self_or_tenant_scope ON users;
CREATE POLICY users_self_or_tenant_scope ON users
  USING (
    id = nullif(current_setting('app.user_id', true), '')::uuid
    OR id IN (
      SELECT user_id FROM agency_memberships
      WHERE agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    )
  )
  WITH CHECK (id = nullif(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE agency_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_memberships FORCE ROW LEVEL SECURITY;

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;

-- 2. Formalize Pipelines Table
CREATE TABLE IF NOT EXISTS pipelines (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipelines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pipelines_tenant_scope ON pipelines;
CREATE POLICY pipelines_tenant_scope ON pipelines
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- 3. Formalize Pipeline Stages Table
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  pipeline_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  position integer NOT NULL DEFAULT 0,
  probability numeric(5,2) DEFAULT 100.0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, pipeline_id, id),
  FOREIGN KEY (agency_id, location_id, pipeline_id) REFERENCES pipelines(agency_id, location_id, id) ON DELETE CASCADE
);

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pipeline_stages_tenant_scope ON pipeline_stages;
CREATE POLICY pipeline_stages_tenant_scope ON pipeline_stages
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- 4. Formalize Opportunities Table
CREATE TABLE IF NOT EXISTS opportunities (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  pipeline_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  contact_id uuid,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  value numeric(14,2) NOT NULL DEFAULT 0.0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'abandoned')),
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  close_date timestamptz,
  source text,
  custom_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS opportunities_tenant_scope ON opportunities;
CREATE POLICY opportunities_tenant_scope ON opportunities
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_opportunities_pipeline_stage ON opportunities(agency_id, location_id, pipeline_id, stage_id);

-- 5. Formalize Calendars Table
CREATE TABLE IF NOT EXISTS calendars (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  slug text NOT NULL,
  color text DEFAULT '#4f46e5',
  duration_min integer NOT NULL DEFAULT 30,
  availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  round_robin boolean NOT NULL DEFAULT false,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

ALTER TABLE calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendars FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendars_tenant_scope ON calendars;
CREATE POLICY calendars_tenant_scope ON calendars
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- 6. Formalize Appointments Table
CREATE TABLE IF NOT EXISTS appointments (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  calendar_id uuid NOT NULL,
  contact_id uuid,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS appointments_tenant_scope ON appointments;
CREATE POLICY appointments_tenant_scope ON appointments
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

CREATE INDEX IF NOT EXISTS idx_appointments_calendar_time ON appointments(agency_id, location_id, calendar_id, starts_at);
