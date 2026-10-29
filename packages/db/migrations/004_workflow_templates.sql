-- Migration 004: Pre-built Workflow Templates Catalog
-- Supports both global system templates and tenant-custom agency templates

CREATE TABLE IF NOT EXISTS workflow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 150),
  description text NOT NULL DEFAULT '',
  category text NOT NULL CHECK (category IN (
    'Lead Capture & Nurture',
    'AI & Autonomous Agents',
    'Sales Pipeline Automation',
    'Customer Retention & Reviews',
    'Omnichannel Messaging',
    'Custom Integrations'
  )),
  trigger_type text NOT NULL CHECK (trigger_type IN ('form', 'tag', 'appointment', 'opportunity_stage', 'invoice', 'payment', 'webhook', 'schedule', 'manual')),
  nodes jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_public boolean NOT NULL DEFAULT true,
  installs integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_templates_cat_idx ON workflow_templates(category, is_public);

-- RLS: Public templates are readable by any authenticated tenant; private templates by owning agency
ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_templates_select_policy ON workflow_templates;
CREATE POLICY workflow_templates_select_policy ON workflow_templates
  FOR SELECT
  USING (
    is_public = true
    OR agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
  );

DROP POLICY IF EXISTS workflow_templates_mutate_policy ON workflow_templates;
CREATE POLICY workflow_templates_mutate_policy ON workflow_templates
  FOR ALL
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_templates TO operza_app;
  END IF;
END $$;

-- Seed Curated Production Templates
INSERT INTO workflow_templates (id, agency_id, name, description, category, trigger_type, is_public, nodes)
VALUES 
  (
    '00000000-0000-0000-0000-000000000001',
    NULL,
    'Instant Lead Capture, AI Scoring & SMS Dispatch',
    'Ingests new website form submissions, evaluates lead intent using AI Copilot, sends personalized SMS, and adds a hot-lead tag.',
    'Lead Capture & Nurture',
    'form',
    true,
    '[
      {"id": "node_1", "type": "ai_agent", "name": "AI Lead Qualifier", "config": {"prompt": "Analyze lead submission: {{answers}}. Score intent 1-100 and summarize core need."}},
      {"id": "node_2", "type": "tag", "name": "Tag Inbound Lead", "config": {"tag": "hot-inbound"}},
      {"id": "node_3", "type": "sms", "name": "Welcome SMS", "config": {"message": "Hi {{contact.firstName}}, thanks for reaching out! We received your inquiry and are reviewing your details now."}},
      {"id": "node_4", "type": "task", "name": "Create Sales Call Task", "config": {"title": "Call {{contact.firstName}} {{contact.lastName}}", "priority": "high"}}
    ]'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    NULL,
    'Opportunity Won - Automated Invoicing & Review Request',
    'Fires when an opportunity moves to Won stage. Creates a follow-up invoice, schedules a Google Review request after 2 hours.',
    'Sales Pipeline Automation',
    'opportunity_stage',
    true,
    '[
      {"id": "node_1", "type": "email", "name": "Send Onboarding Welcome", "config": {"subject": "Welcome to Operza! Your onboarding details", "body": "Hi {{contact.firstName}}, congratulations! We are excited to partner with you."}},
      {"id": "node_2", "type": "delay", "name": "Wait 2 Hours", "config": {"durationMinutes": 120}},
      {"id": "node_3", "type": "send_review_request", "name": "Request Google Review", "config": {"channel": "sms", "template": "Hi {{contact.firstName}}, how was your onboarding experience with us? Mind leaving a quick review: {{reviewLink}}"}}
    ]'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    NULL,
    'Autonomous Multi-Step AI Agent with Approval Gate',
    'Deep LangChain-style reasoning agent. Performs CRM lookups, calculates deal terms, and pauses for human manager approval before sending contract proposals.',
    'AI & Autonomous Agents',
    'manual',
    true,
    '[
      {"id": "node_1", "type": "ai_agent", "name": "Autonomous Pricing Estimator", "config": {"prompt": "Calculate discount tier and custom proposal contract terms for {{contact.company}}."}},
      {"id": "node_2", "type": "task", "name": "Awaiting Manager Approval", "config": {"title": "Approve Contract Terms for {{contact.company}}"}, "requiresApproval": true},
      {"id": "node_3", "type": "email", "name": "Deliver Approved Proposal", "config": {"subject": "Custom Proposal from Operza", "body": "Please find your approved contract details attached."}}
    ]'::jsonb
  )
ON CONFLICT (id) DO NOTHING;
