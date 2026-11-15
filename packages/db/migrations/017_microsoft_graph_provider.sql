-- Migration 017: Add delegated Microsoft Graph mailbox connections.
-- The actual tenant authorization is performed through an explicit OAuth consent flow.

ALTER TABLE provider_connections
  DROP CONSTRAINT IF EXISTS provider_connections_provider_key_check;

ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_provider_key_check
  CHECK (provider_key IN (
    'email.sendgrid',
    'email.resend',
    'email.microsoft_graph',
    'sms.twilio',
    'whatsapp.meta_cloud',
    'payments.stripe'
  ));
