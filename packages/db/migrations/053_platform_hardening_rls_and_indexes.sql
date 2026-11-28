-- Migration 053: Platform Hardening — Remaining Tenant RLS & Composite Performance Indexes

-- 1. Enable + FORCE ROW LEVEL SECURITY on remaining agency-owned tables
ALTER TABLE IF EXISTS auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS auth_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_sessions_tenant_isolation ON auth_sessions;
CREATE POLICY auth_sessions_tenant_isolation ON auth_sessions
  USING (
    agency_id::text = NULLIF(current_setting('app.agency_id', true), '')
    OR user_id::text = NULLIF(current_setting('app.user_id', true), '')
  )
  WITH CHECK (
    agency_id::text = NULLIF(current_setting('app.agency_id', true), '')
    OR user_id::text = NULLIF(current_setting('app.user_id', true), '')
  );

ALTER TABLE IF EXISTS commerce_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS commerce_webhook_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_webhook_events_tenant_isolation ON commerce_webhook_events;
CREATE POLICY commerce_webhook_events_tenant_isolation ON commerce_webhook_events
  USING (agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid)
  WITH CHECK (agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid);

ALTER TABLE IF EXISTS marketplace_analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS marketplace_analytics_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_analytics_events_tenant_isolation ON marketplace_analytics_events;
CREATE POLICY marketplace_analytics_events_tenant_isolation ON marketplace_analytics_events
  USING (agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid)
  WITH CHECK (agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid);

ALTER TABLE IF EXISTS public_form_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public_form_registry FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_form_registry_tenant_isolation ON public_form_registry;
CREATE POLICY public_form_registry_tenant_isolation ON public_form_registry
  USING (agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid)
  WITH CHECK (agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid);

-- 2. Composite performance indexes for high-traffic tenant-scoped lookups
CREATE INDEX IF NOT EXISTS idx_auth_sessions_agency_user
  ON auth_sessions (agency_id, user_id);

CREATE INDEX IF NOT EXISTS idx_user_location_memberships_agency_user
  ON user_location_memberships (agency_id, user_id);

CREATE INDEX IF NOT EXISTS idx_commerce_refunds_agency_loc_payment
  ON commerce_refunds (agency_id, location_id, payment_id);
