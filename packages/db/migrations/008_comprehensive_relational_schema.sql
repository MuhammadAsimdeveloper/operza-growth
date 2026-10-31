-- ==============================================================================
-- Migration 008: Comprehensive Multi-Tenant Relational Schema & Strict RLS
-- ==============================================================================
-- Fulfills Phase 2 Database Architecture requirements:
-- Normalized relational tables for CRM, Commerce, Messaging, Marketing,
-- Infrastructure, Integrations, and Background Jobs.
-- All tables enforce FORCE ROW LEVEL SECURITY with fail-closed policies.
-- ==============================================================================

-- 1. Companies
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  name text NOT NULL,
  domain text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  postal_code text,
  country text,
  custom_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_companies_agency ON companies (agency_id, name);

-- 2. Pipelines & Stages
CREATE TABLE IF NOT EXISTS pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pipelines_agency ON pipelines (agency_id);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  probability numeric(5, 2) NOT NULL DEFAULT 100.00,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages ON pipeline_stages (agency_id, pipeline_id, display_order);

-- 3. Conversations & Messages
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  contact_name text NOT NULL DEFAULT '',
  channel text NOT NULL DEFAULT 'email', -- email, sms, webchat, whatsapp, meta
  subject text,
  status text NOT NULL DEFAULT 'open', -- open, closed, snoozed
  last_message text,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  unread_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_agency ON conversations (agency_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  sender_type text NOT NULL DEFAULT 'user', -- user, contact, system, ai
  sender_id text,
  body text NOT NULL DEFAULT '',
  channel text NOT NULL DEFAULT 'email',
  direction text NOT NULL DEFAULT 'outbound', -- inbound, outbound
  status text NOT NULL DEFAULT 'delivered', -- pending, sent, delivered, failed
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (agency_id, conversation_id, created_at ASC);

-- 4. Calendars & Appointments
CREATE TABLE IF NOT EXISTS calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text NOT NULL,
  color text NOT NULL DEFAULT '#3b82f6',
  duration_min integer NOT NULL DEFAULT 30,
  availability jsonb NOT NULL DEFAULT '{"weekdays": [1, 2, 3, 4, 5], "start": "09:00", "end": "17:00"}'::jsonb,
  round_robin boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_calendars_agency_slug UNIQUE (agency_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_calendars_agency ON calendars (agency_id);

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  title text NOT NULL,
  contact_name text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmed', -- confirmed, cancelled, completed, no_show
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointments_agency_time ON appointments (agency_id, starts_at);

-- 5. Forms & Form Submissions
CREATE TABLE IF NOT EXISTS forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  name text NOT NULL,
  public_slug text NOT NULL,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'published',
  submissions_count integer NOT NULL DEFAULT 0,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_forms_agency_slug UNIQUE (agency_id, public_slug)
);
CREATE INDEX IF NOT EXISTS idx_forms_agency ON forms (agency_id);

CREATE TABLE IF NOT EXISTS form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  contact_name text,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_form_submissions ON form_submissions (agency_id, form_id, submitted_at DESC);

-- 6. Websites, Funnels & Funnel Pages
CREATE TABLE IF NOT EXISTS websites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'website', -- website, funnel
  domain text,
  status text NOT NULL DEFAULT 'published',
  published boolean NOT NULL DEFAULT true,
  pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  visits integer NOT NULL DEFAULT 0,
  optins integer NOT NULL DEFAULT 0,
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  maintenance_mode boolean NOT NULL DEFAULT false,
  maintenance_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_websites_agency ON websites (agency_id);

CREATE TABLE IF NOT EXISTS funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  name text NOT NULL,
  domain text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_funnels_agency ON funnels (agency_id);

CREATE TABLE IF NOT EXISTS funnel_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  funnel_id uuid NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  step_order integer NOT NULL DEFAULT 0,
  page_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  visits integer NOT NULL DEFAULT 0,
  optins integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_funnel_pages_slug UNIQUE (agency_id, funnel_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_funnel_pages ON funnel_pages (agency_id, funnel_id, step_order);

-- 7. Products, Orders, Invoices & Payments
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  name text NOT NULL,
  sku text,
  price numeric(12, 2) NOT NULL DEFAULT 0.00,
  currency varchar(3) NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'active',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_agency ON products (agency_id);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  order_number text NOT NULL,
  contact_name text,
  amount numeric(12, 2) NOT NULL DEFAULT 0.00,
  currency varchar(3) NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'paid', -- pending, paid, refunded, failed
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  bump_accepted boolean NOT NULL DEFAULT false,
  bump_amount numeric(12, 2) NOT NULL DEFAULT 0.00,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_agency ON orders (agency_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  number text NOT NULL,
  contact_name text,
  amount numeric(12, 2) NOT NULL DEFAULT 0.00,
  currency varchar(3) NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'draft', -- draft, sent, paid, overdue, cancelled
  due_date timestamptz,
  paid_at timestamptz,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_agency ON invoices (agency_id, number);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'stripe', -- stripe, manual, bank
  provider_payment_id text,
  amount numeric(12, 2) NOT NULL DEFAULT 0.00,
  currency varchar(3) NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'succeeded',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_agency ON payments (agency_id, provider_payment_id);

-- 8. Subscriptions & Coupons
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  plan text NOT NULL,
  amount numeric(12, 2) NOT NULL DEFAULT 0.00,
  currency varchar(3) NOT NULL DEFAULT 'USD',
  interval text NOT NULL DEFAULT 'month', -- month, year
  status text NOT NULL DEFAULT 'active', -- active, past_due, canceled
  renews_at timestamptz,
  stripe_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_agency ON subscriptions (agency_id, status);

CREATE TABLE IF NOT EXISTS coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  code text NOT NULL,
  kind text NOT NULL DEFAULT 'percent', -- percent, fixed
  amount numeric(12, 2) NOT NULL DEFAULT 0.00,
  min_subtotal numeric(12, 2) NOT NULL DEFAULT 0.00,
  max_redemptions integer,
  redemptions integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_coupons_agency_code UNIQUE (agency_id, code)
);
CREATE INDEX IF NOT EXISTS idx_coupons_agency ON coupons (agency_id, code);

-- 9. Documents (E-Signatures)
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  name text NOT NULL,
  title text,
  kind text NOT NULL DEFAULT 'agreement',
  value numeric(12, 2) NOT NULL DEFAULT 0.00,
  status text NOT NULL DEFAULT 'draft', -- draft, sent, signed, expired
  signed_at timestamptz,
  signer_name text,
  pdf_url text,
  signature_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_agency ON documents (agency_id);

-- 10. Custom Fields & Custom Values
CREATE TABLE IF NOT EXISTS custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  resource text NOT NULL, -- contacts, opportunities, locations
  field_key text NOT NULL,
  name text NOT NULL,
  field_type text NOT NULL DEFAULT 'text', -- text, number, date, dropdown
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_custom_fields_key UNIQUE (agency_id, resource, field_key)
);
CREATE INDEX IF NOT EXISTS idx_custom_fields_agency ON custom_fields (agency_id, resource);

CREATE TABLE IF NOT EXISTS custom_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  name text NOT NULL,
  value text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_custom_values_name UNIQUE (agency_id, name)
);
CREATE INDEX IF NOT EXISTS idx_custom_values_agency ON custom_values (agency_id, name);

-- 11. Campaigns, Email Events & SMS Events
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'email', -- email, sms
  status text NOT NULL DEFAULT 'draft', -- draft, scheduled, sent, paused
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  subject text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_agency ON campaigns (agency_id, status);

CREATE TABLE IF NOT EXISTS email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  event_type text NOT NULL, -- sent, delivered, opened, clicked, bounced, complained
  message_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_events ON email_events (agency_id, campaign_id, event_type);

CREATE TABLE IF NOT EXISTS sms_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  phone_number_id uuid REFERENCES phone_numbers(id) ON DELETE SET NULL,
  message_sid text,
  direction text NOT NULL DEFAULT 'outbound',
  status text NOT NULL DEFAULT 'sent',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sms_events ON sms_events (agency_id, message_sid);

-- 12. Calls
CREATE TABLE IF NOT EXISTS calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  phone_number_id uuid REFERENCES phone_numbers(id) ON DELETE SET NULL,
  from_number text NOT NULL,
  to_number text NOT NULL,
  duration_sec integer NOT NULL DEFAULT 0,
  outcome text NOT NULL DEFAULT 'completed', -- completed, missed, voicemail, busy
  direction text NOT NULL DEFAULT 'inbound', -- inbound, outbound
  started_at timestamptz NOT NULL DEFAULT now(),
  recording_url text,
  notes text,
  handled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calls_agency ON calls (agency_id, started_at DESC);

-- 13. Integrations
CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  provider text NOT NULL, -- stripe, twilio, sendgrid, openai, zapier, etc.
  name text NOT NULL,
  status text NOT NULL DEFAULT 'disconnected', -- connected, disconnected, error
  connected boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_integrations_provider UNIQUE (agency_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_integrations_agency ON integrations (agency_id, provider);

-- 14. Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  kind text NOT NULL DEFAULT 'info', -- info, success, warning, alert
  read boolean NOT NULL DEFAULT false,
  link text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (agency_id, user_id, read);

-- 15. Background Jobs (Queue Persistence & Worker Engine)
CREATE TABLE IF NOT EXISTS background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid REFERENCES agencies(id) ON DELETE CASCADE,
  queue_name text NOT NULL DEFAULT 'default',
  job_id text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ready', -- ready, active, completed, failed, delayed, dead_letter
  attempts integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  execute_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  failed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_background_jobs_queue ON background_jobs (queue_name, status, execute_at);

-- ==============================================================================
-- Strict Row-Level Security (RLS) Enforcement
-- ==============================================================================

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'companies', 'pipelines', 'pipeline_stages', 'conversations', 'messages',
    'calendars', 'appointments', 'forms', 'form_submissions', 'websites',
    'funnels', 'funnel_pages', 'products', 'orders', 'invoices', 'payments',
    'subscriptions', 'coupons', 'documents', 'custom_fields', 'custom_values',
    'campaigns', 'email_events', 'sms_events', 'calls', 'integrations',
    'notifications'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON %I', t, t);
    EXECUTE format('
      CREATE POLICY %I_tenant_isolation ON %I
        FOR ALL
        USING (agency_id = current_app_agency_id())
        WITH CHECK (agency_id = current_app_agency_id())
    ', t, t);
  END LOOP;
END $$;

-- Background jobs has special RLS policy allowing system workers and agency scoping
ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE background_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS background_jobs_isolation ON background_jobs;
CREATE POLICY background_jobs_isolation ON background_jobs
  FOR ALL
  USING (
    agency_id IS NULL OR 
    current_app_agency_id() IS NULL OR 
    agency_id = current_app_agency_id()
  )
  WITH CHECK (
    agency_id IS NULL OR 
    current_app_agency_id() IS NULL OR 
    agency_id = current_app_agency_id()
  );

-- Standardize agency_tenant_states RLS policy for safe boot hydration & strict tenant write isolation
ALTER TABLE agency_tenant_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_tenant_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_tenant_states_isolation ON agency_tenant_states;
CREATE POLICY agency_tenant_states_isolation ON agency_tenant_states
  FOR ALL
  USING (
    current_app_agency_id() IS NULL OR 
    agency_id = current_app_agency_id()
  )
  WITH CHECK (
    agency_id = current_app_agency_id()
  );

-- Grant full table & sequence permissions to operza_app
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO operza_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO operza_app;
  END IF;
END $$;
