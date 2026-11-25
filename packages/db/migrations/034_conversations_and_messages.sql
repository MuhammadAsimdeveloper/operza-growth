-- Phase 1.8: Messaging, Conversations & Messages Relational Schema
-- Enforces composite tenant PKs, FORCE ROW LEVEL SECURITY, delivery status checks,
-- and provider_message_id / idempotency_key uniqueness for safe webhook & retry handling.

CREATE TABLE IF NOT EXISTS conversations (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  contact_id uuid,
  contact_name text NOT NULL DEFAULT 'Unknown Contact',
  channel text NOT NULL DEFAULT 'sms'
    CHECK (channel IN ('sms', 'email', 'whatsapp', 'meta', 'webchat', 'voice', 'other')),
  subject text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending', 'resolved', 'closed', 'archived')),
  assigned_to text,
  last_message text,
  last_message_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS conversations_location_updated_idx
  ON conversations (agency_id, location_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS conversations_contact_idx
  ON conversations (agency_id, location_id, contact_id, channel)
  WHERE contact_id IS NOT NULL;

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversations_tenant_scope ON conversations;
CREATE POLICY conversations_tenant_scope ON conversations
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

CREATE TABLE IF NOT EXISTS messages (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  contact_id uuid,
  channel text NOT NULL DEFAULT 'sms'
    CHECK (channel IN ('sms', 'email', 'whatsapp', 'meta', 'webchat', 'voice', 'other')),
  direction text NOT NULL DEFAULT 'outbound'
    CHECK (direction IN ('inbound', 'outbound')),
  sender_type text NOT NULL DEFAULT 'agent'
    CHECK (sender_type IN ('agent', 'contact', 'bot', 'system', 'campaign')),
  sender_name text,
  subject text,
  body text NOT NULL DEFAULT '',
  delivery_status text NOT NULL DEFAULT 'queued'
    CHECK (delivery_status IN ('queued', 'processing', 'sent', 'delivered', 'failed', 'read', 'cancelled')),
  provider text,
  provider_message_id text,
  idempotency_key text,
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, conversation_id) REFERENCES conversations(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (agency_id, location_id, conversation_id, created_at ASC);
CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_message_idx
  ON messages (agency_id, location_id, provider, provider_message_id)
  WHERE provider IS NOT NULL AND provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency_idx
  ON messages (agency_id, location_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messages_tenant_scope ON messages;
CREATE POLICY messages_tenant_scope ON messages
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON conversations, messages TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON conversations, messages TO operza_worker;
  END IF;
END $$;
