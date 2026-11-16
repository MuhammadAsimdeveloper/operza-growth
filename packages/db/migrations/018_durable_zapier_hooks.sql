-- Migration 018: secure tenant-scoped Zapier hooks with durable outbox receipts.
CREATE TABLE IF NOT EXISTS zapier_rest_hook_subscriptions(
 id uuid NOT NULL,agency_id uuid NOT NULL,location_id uuid NOT NULL,
 event text NOT NULL CHECK(event ~ '^[a-z][a-z0-9_.-]{1,120}$'),
 target_url text NOT NULL CHECK(target_url LIKE 'https://%' AND length(target_url)<=2048),
 signing_secret_ref text NOT NULL CHECK(signing_secret_ref LIKE 'vault:%' AND length(signing_secret_ref) BETWEEN 80 AND 240),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','deactivated','cancelled')),
 consecutive_failures integer NOT NULL DEFAULT 0 CHECK(consecutive_failures>=0),deactivation_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(agency_id,location_id,id),FOREIGN KEY(agency_id,location_id) REFERENCES locations(agency_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS zapier_rest_hook_subscriptions_event_idx ON zapier_rest_hook_subscriptions(agency_id,location_id,event,status);
CREATE TABLE IF NOT EXISTS zapier_rest_hook_deliveries(
 id uuid NOT NULL,agency_id uuid NOT NULL,location_id uuid NOT NULL,subscription_id uuid NOT NULL,job_id uuid NOT NULL,
 event text NOT NULL CHECK(event ~ '^[a-z][a-z0-9_.-]{1,120}$'),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND pg_column_size(payload)<=65536),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','retrying','delivered','dead_letter')),
 http_status integer,attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz,
 PRIMARY KEY(agency_id,location_id,id),UNIQUE(agency_id,location_id,job_id),
 FOREIGN KEY(agency_id,location_id,subscription_id) REFERENCES zapier_rest_hook_subscriptions(agency_id,location_id,id) ON DELETE CASCADE,
 FOREIGN KEY(agency_id,location_id,job_id) REFERENCES workflow_outbox(agency_id,location_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS zapier_rest_hook_deliveries_recent_idx ON zapier_rest_hook_deliveries(agency_id,location_id,created_at DESC);
ALTER TABLE zapier_rest_hook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE zapier_rest_hook_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zapier_rest_hook_subscriptions_app_scope ON zapier_rest_hook_subscriptions;
CREATE POLICY zapier_rest_hook_subscriptions_app_scope ON zapier_rest_hook_subscriptions FOR ALL TO operza_app USING(agency_id=nullif(current_setting('app.agency_id',true),'')::uuid AND location_id=nullif(current_setting('app.location_id',true),'')::uuid) WITH CHECK(agency_id=nullif(current_setting('app.agency_id',true),'')::uuid AND location_id=nullif(current_setting('app.location_id',true),'')::uuid);
ALTER TABLE zapier_rest_hook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE zapier_rest_hook_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zapier_rest_hook_deliveries_app_scope ON zapier_rest_hook_deliveries;
CREATE POLICY zapier_rest_hook_deliveries_app_scope ON zapier_rest_hook_deliveries FOR ALL TO operza_app USING(agency_id=nullif(current_setting('app.agency_id',true),'')::uuid AND location_id=nullif(current_setting('app.location_id',true),'')::uuid) WITH CHECK(agency_id=nullif(current_setting('app.agency_id',true),'')::uuid AND location_id=nullif(current_setting('app.location_id',true),'')::uuid);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='operza_app') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON zapier_rest_hook_subscriptions,zapier_rest_hook_deliveries TO operza_app; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='operza_worker') THEN
  GRANT SELECT,UPDATE ON zapier_rest_hook_subscriptions,zapier_rest_hook_deliveries TO operza_worker;
  GRANT SELECT ON provider_secrets TO operza_worker;
  DROP POLICY IF EXISTS zapier_rest_hook_subscriptions_worker_scope ON zapier_rest_hook_subscriptions;
  CREATE POLICY zapier_rest_hook_subscriptions_worker_scope ON zapier_rest_hook_subscriptions FOR ALL TO operza_worker USING(true) WITH CHECK(true);
  DROP POLICY IF EXISTS zapier_rest_hook_deliveries_worker_scope ON zapier_rest_hook_deliveries;
  CREATE POLICY zapier_rest_hook_deliveries_worker_scope ON zapier_rest_hook_deliveries FOR ALL TO operza_worker USING(true) WITH CHECK(true);
  DROP POLICY IF EXISTS provider_secrets_worker_scope ON provider_secrets;
  CREATE POLICY provider_secrets_worker_scope ON provider_secrets FOR SELECT TO operza_worker USING(true);
 END IF;
END $$;
