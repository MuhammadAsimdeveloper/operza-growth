-- Migration 022: Tenant RLS and Worker Consent Verification
-- 1. Ensure operza_app role has necessary table access under strict RLS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      agencies, users, agency_memberships, locations, auth_sessions, agency_audit_events,
      calendars, appointments, location_records, opportunities,
      workflow_definitions, workflow_executions, workflow_execution_steps,
      workflow_approvals, workflow_outbox, communication_consents,
      provider_connections, workflow_action_receipts, tenant_entitlements, usage_events
    TO operza_app;

    -- Allow operza_app signup insertions and session resolution
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'users_app_signup_scope') THEN
      CREATE POLICY users_app_signup_scope ON users FOR INSERT TO operza_app WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'users_app_read_scope') THEN
      CREATE POLICY users_app_read_scope ON users FOR SELECT TO operza_app USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'agencies_app_signup_scope') THEN
      CREATE POLICY agencies_app_signup_scope ON agencies FOR INSERT TO operza_app WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'agencies_app_read_scope') THEN
      CREATE POLICY agencies_app_read_scope ON agencies FOR SELECT TO operza_app USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'locations_app_signup_scope') THEN
      CREATE POLICY locations_app_signup_scope ON locations FOR INSERT TO operza_app WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'locations_app_read_scope') THEN
      CREATE POLICY locations_app_read_scope ON locations FOR SELECT TO operza_app USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'memberships_app_signup_scope') THEN
      CREATE POLICY memberships_app_signup_scope ON agency_memberships FOR INSERT TO operza_app WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'memberships_app_read_scope') THEN
      CREATE POLICY memberships_app_read_scope ON agency_memberships FOR SELECT TO operza_app USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'calendars_app_scope') THEN
      CREATE POLICY calendars_app_scope ON calendars FOR ALL TO operza_app
        USING (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid)
        WITH CHECK (agency_id = nullif(current_setting('app.agency_id', true), '')::uuid);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'appointments_app_scope') THEN
      CREATE POLICY appointments_app_scope ON appointments FOR ALL TO operza_app
        USING (
          agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
          AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
        )
        WITH CHECK (
          agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
          AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
        );
    END IF;
  END IF;

  -- 2. Give operza_worker read-only access to verify communication consent records
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT ON communication_consents TO operza_worker;

    DROP POLICY IF EXISTS communication_consents_worker_scope ON communication_consents;
    CREATE POLICY communication_consents_worker_scope ON communication_consents
      FOR SELECT TO operza_worker
      USING (
        agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
        AND (
          nullif(current_setting('app.location_id', true), '') IS NULL
          OR location_id IS NULL
          OR location_id = nullif(current_setting('app.location_id', true), '')::uuid
        )
      );
  END IF;
END $$;
