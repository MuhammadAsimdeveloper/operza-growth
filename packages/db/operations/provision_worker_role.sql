-- Provision the isolated worker role AFTER migration 008 has been applied.
-- Run as a database owner/superuser. No password or credential is stored in this file.
-- Set a strong password out-of-band using your deployment secret manager.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    CREATE ROLE operza_worker LOGIN;
  END IF;
END $$;

SELECT format('GRANT CONNECT ON DATABASE %I TO operza_worker', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO operza_worker;
GRANT SELECT, UPDATE ON workflow_outbox TO operza_worker;
GRANT SELECT, INSERT, UPDATE ON workflow_action_receipts TO operza_worker;

ALTER TABLE workflow_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_outbox_worker_scope ON workflow_outbox;
CREATE POLICY workflow_outbox_worker_scope ON workflow_outbox TO operza_worker
  USING (true) WITH CHECK (true);

ALTER TABLE workflow_action_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_action_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_action_receipts_worker_scope ON workflow_action_receipts;
CREATE POLICY workflow_action_receipts_worker_scope ON workflow_action_receipts TO operza_worker
  USING (true) WITH CHECK (true);

-- The worker can read/update queue state and write action receipts only.
-- It has no permission to modify CRM contacts, payment records, sessions, or provider secrets.
