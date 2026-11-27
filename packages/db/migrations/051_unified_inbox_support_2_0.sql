-- Migration 051: Unified Inbox & Customer Support 2.0
-- Extends conversations lifecycle & SLA tracking, adds support_teams,
-- sla_policies, support_tickets, support_saved_replies, and support_saved_views
-- with composite tenant keys, FORCE ROW LEVEL SECURITY, and least-privilege grants.

-- =========================================================================
-- 1. EXTEND CONVERSATIONS FOR SUPPORT LIFECYCLE, CONCURRENCY & SLA
-- =========================================================================
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_status_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_status_check
  CHECK (status IN (
    'open',
    'pending',
    'waiting_on_customer',
    'waiting_on_internal',
    'resolved',
    'closed',
    'archived'
  ));

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS assigned_agent_name text,
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_policy_id uuid,
  ADD COLUMN IF NOT EXISTS sla_first_response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_next_response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_resolution_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_breached boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sla_status text NOT NULL DEFAULT 'none'
    CHECK (sla_status IN ('none', 'on_track', 'approaching', 'breached', 'paused', 'completed'));

CREATE INDEX IF NOT EXISTS conversations_support_inbox_idx
  ON conversations (agency_id, location_id, status, priority, updated_at DESC);

CREATE INDEX IF NOT EXISTS conversations_assigned_idx
  ON conversations (agency_id, location_id, assigned_to, status);

CREATE INDEX IF NOT EXISTS conversations_team_idx
  ON conversations (agency_id, location_id, team_id, status);

CREATE INDEX IF NOT EXISTS conversations_sla_idx
  ON conversations (agency_id, location_id, sla_breached, sla_resolution_due_at);

-- =========================================================================
-- 2. SUPPORT TEAMS
-- =========================================================================
CREATE TABLE IF NOT EXISTS support_teams (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  member_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_sla_policy_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, slug),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

ALTER TABLE support_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_teams FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_teams_tenant_scope ON support_teams;
CREATE POLICY support_teams_tenant_scope ON support_teams
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- =========================================================================
-- 3. SLA POLICIES
-- =========================================================================
CREATE TABLE IF NOT EXISTS sla_policies (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  is_default boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'UTC',
  business_hours jsonb NOT NULL DEFAULT '{"enabled":true,"startHour":9,"endHour":17,"days":[1,2,3,4,5]}'::jsonb,
  targets_by_priority jsonb NOT NULL DEFAULT '{"urgent":{"firstResponseMin":15,"nextResponseMin":30,"resolutionMin":240},"high":{"firstResponseMin":60,"nextResponseMin":120,"resolutionMin":480},"normal":{"firstResponseMin":240,"nextResponseMin":480,"resolutionMin":1440},"low":{"firstResponseMin":480,"nextResponseMin":1440,"resolutionMin":2880}}'::jsonb,
  pause_statuses jsonb NOT NULL DEFAULT '["waiting_on_customer"]'::jsonb,
  escalation_minutes_before integer NOT NULL DEFAULT 30 CHECK (escalation_minutes_before >= 1),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sla_policies_tenant_scope ON sla_policies;
CREATE POLICY sla_policies_tenant_scope ON sla_policies
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- =========================================================================
-- 4. SUPPORT TICKETS (LINKED TO CONVERSATIONS & CRM)
-- =========================================================================
CREATE TABLE IF NOT EXISTS support_tickets (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL,
  conversation_id uuid,
  contact_id uuid,
  opportunity_id uuid,
  appointment_id uuid,
  subject text NOT NULL CHECK (length(subject) BETWEEN 2 AND 200),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending', 'waiting_on_customer', 'waiting_on_internal', 'resolved', 'closed')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  category text NOT NULL DEFAULT 'general',
  assigned_to text,
  team_id uuid,
  resolution_summary text,
  resolved_at timestamptz,
  closed_at timestamptz,
  reopened_count integer NOT NULL DEFAULT 0 CHECK (reopened_count >= 0),
  version integer NOT NULL DEFAULT 1,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, ticket_number),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, location_id, conversation_id) REFERENCES conversations(agency_id, location_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS support_tickets_lookup_idx
  ON support_tickets (agency_id, location_id, status, priority, updated_at DESC);

CREATE INDEX IF NOT EXISTS support_tickets_conv_idx
  ON support_tickets (agency_id, location_id, conversation_id)
  WHERE conversation_id IS NOT NULL;

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_tickets_tenant_scope ON support_tickets;
CREATE POLICY support_tickets_tenant_scope ON support_tickets
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- =========================================================================
-- 5. SAVED REPLIES & SAVED INBOX VIEWS
-- =========================================================================
CREATE TABLE IF NOT EXISTS support_saved_replies (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  category text NOT NULL DEFAULT 'general',
  scope text NOT NULL DEFAULT 'agency' CHECK (scope IN ('personal', 'team', 'agency')),
  owner_id text,
  team_id uuid,
  channel text NOT NULL DEFAULT 'all',
  body text NOT NULL,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  archived boolean NOT NULL DEFAULT false,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

ALTER TABLE support_saved_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_saved_replies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_saved_replies_tenant_scope ON support_saved_replies;
CREATE POLICY support_saved_replies_tenant_scope ON support_saved_replies
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

CREATE TABLE IF NOT EXISTS support_saved_views (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  owner_id text,
  is_shared boolean NOT NULL DEFAULT false,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

ALTER TABLE support_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_saved_views FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_saved_views_tenant_scope ON support_saved_views;
CREATE POLICY support_saved_views_tenant_scope ON support_saved_views
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- =========================================================================
-- 6. LEAST-PRIVILEGE ROLE GRANTS
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON support_teams, sla_policies, support_tickets, support_saved_replies, support_saved_views TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON support_teams, sla_policies, support_tickets, support_saved_replies, support_saved_views TO operza_worker;
  END IF;
END $$;
