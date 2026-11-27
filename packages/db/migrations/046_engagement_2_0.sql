-- Product Advancement Stage 9: Customer Engagement & Marketing Automation 2.0
-- Enforces composite tenant PKs, FORCE ROW LEVEL SECURITY, and least-privilege role grants.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  ADD COLUMN IF NOT EXISTS team_id text;

CREATE TABLE IF NOT EXISTS engagement_conversation_notes (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  author_id text NOT NULL,
  author_name text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, conversation_id)
    REFERENCES conversations(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS engagement_conversation_history (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  actor_id text NOT NULL,
  event_type text NOT NULL,
  from_value text,
  to_value text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, conversation_id)
    REFERENCES conversations(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS engagement_templates (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'internal_notification')),
  subject text,
  body text NOT NULL,
  variables_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_status text NOT NULL DEFAULT 'draft'
    CHECK (approval_status IN ('draft', 'pending_provider_approval', 'approved', 'rejected', 'archived')),
  provider_template_id text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS engagement_campaigns (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  objective text NOT NULL DEFAULT 'engagement',
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'internal_notification')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready_for_review', 'approved', 'scheduled', 'sending', 'paused', 'completed', 'failed', 'cancelled')),
  smart_list_id uuid,
  audience_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_id uuid,
  subject text,
  body text NOT NULL DEFAULT '',
  timezone text NOT NULL DEFAULT 'UTC',
  send_window jsonb NOT NULL DEFAULT '{"startHour":8,"endHour":20}'::jsonb,
  scheduled_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  total_recipients integer NOT NULL DEFAULT 0 CHECK (total_recipients >= 0),
  eligible_recipients integer NOT NULL DEFAULT 0 CHECK (eligible_recipients >= 0),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS engagement_campaign_recipients (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'internal_notification')),
  destination text,
  delivery_state text NOT NULL DEFAULT 'pending'
    CHECK (delivery_state IN ('pending', 'queued', 'submitted', 'sent', 'delivered', 'failed', 'suppressed', 'cancelled')),
  idempotency_key text NOT NULL,
  provider_message_id text,
  error_code text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, campaign_id, contact_id),
  UNIQUE (agency_id, location_id, idempotency_key),
  FOREIGN KEY (agency_id, location_id, campaign_id)
    REFERENCES engagement_campaigns(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS engagement_suppression_list (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'all')),
  identifier text NOT NULL,
  contact_id uuid,
  reason text NOT NULL DEFAULT 'opt_out',
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, channel, identifier),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS engagement_journey_enrollments (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL,
  execution_id uuid,
  contact_id uuid NOT NULL,
  journey_key text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'exited_goal', 'exited_opt_out', 'cancelled', 'failed')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  exited_at timestamptz,
  exit_reason text,
  PRIMARY KEY (agency_id, location_id, id),
  UNIQUE (agency_id, location_id, journey_key, contact_id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS engagement_campaigns_status_idx
  ON engagement_campaigns (agency_id, location_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS engagement_recipients_state_idx
  ON engagement_campaign_recipients (agency_id, location_id, campaign_id, delivery_state);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'engagement_conversation_notes',
    'engagement_conversation_history',
    'engagement_templates',
    'engagement_campaigns',
    'engagement_campaign_recipients',
    'engagement_suppression_list',
    'engagement_journey_enrollments'
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
      engagement_conversation_notes,
      engagement_conversation_history,
      engagement_templates,
      engagement_campaigns,
      engagement_campaign_recipients,
      engagement_suppression_list,
      engagement_journey_enrollments
    TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON
      engagement_conversation_notes,
      engagement_conversation_history,
      engagement_templates,
      engagement_campaigns,
      engagement_campaign_recipients,
      engagement_suppression_list,
      engagement_journey_enrollments
    TO operza_worker;
  END IF;
END $$;
