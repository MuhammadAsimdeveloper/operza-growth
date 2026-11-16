-- Migration 020: Worker execution role grants and RLS policies for operza_worker
-- Ensures background outbox worker running under operza_worker role has necessary permissions
-- for durable workflow execution, node traversal, step logging, and CRM action persistence.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT ON workflow_definitions TO operza_worker;
    GRANT SELECT, INSERT, UPDATE ON workflow_executions TO operza_worker;
    GRANT SELECT, INSERT, UPDATE ON workflow_execution_steps TO operza_worker;
    GRANT SELECT, INSERT, UPDATE ON workflow_approvals TO operza_worker;
    GRANT SELECT, INSERT, UPDATE ON location_records TO operza_worker;
    GRANT SELECT, INSERT, UPDATE ON opportunities TO operza_worker;
    GRANT SELECT, INSERT, UPDATE ON appointments TO operza_worker;
    GRANT SELECT ON calendars TO operza_worker;

    -- Worker scopes across tenant jobs
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'workflow_executions_worker_scope') THEN
      CREATE POLICY workflow_executions_worker_scope ON workflow_executions FOR ALL TO operza_worker USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'workflow_execution_steps_worker_scope') THEN
      CREATE POLICY workflow_execution_steps_worker_scope ON workflow_execution_steps FOR ALL TO operza_worker USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'workflow_approvals_worker_scope') THEN
      CREATE POLICY workflow_approvals_worker_scope ON workflow_approvals FOR ALL TO operza_worker USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'workflow_definitions_worker_scope') THEN
      CREATE POLICY workflow_definitions_worker_scope ON workflow_definitions FOR SELECT TO operza_worker USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'location_records_worker_scope') THEN
      CREATE POLICY location_records_worker_scope ON location_records FOR ALL TO operza_worker USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'opportunities_worker_scope') THEN
      CREATE POLICY opportunities_worker_scope ON opportunities FOR ALL TO operza_worker USING (true) WITH CHECK (true);
    END IF;
  END IF;
END $$;
