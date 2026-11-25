-- Phase 3: Stripe Connect, Payment Links, Coupons & Durable Dunning
-- Enforces composite tenant PKs, FORCE ROW LEVEL SECURITY, idempotency indexes,
-- and least-privilege grants for operza_app and operza_worker.

CREATE TABLE IF NOT EXISTS stripe_connect_accounts (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  stripe_account_id text NOT NULL,
  mode text NOT NULL DEFAULT 'sandbox' CHECK (mode IN ('sandbox', 'production')),
  onboarding_status text NOT NULL DEFAULT 'onboarding_pending'
    CHECK (onboarding_status IN ('not_configured', 'onboarding_pending', 'sandbox_connected', 'production_connected', 'disabled')),
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS stripe_connect_accounts_acct_idx
  ON stripe_connect_accounts (agency_id, location_id, stripe_account_id);

ALTER TABLE stripe_connect_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_connect_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stripe_connect_accounts_tenant_scope ON stripe_connect_accounts;
CREATE POLICY stripe_connect_accounts_tenant_scope ON stripe_connect_accounts
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

CREATE TABLE IF NOT EXISTS payment_links (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  amount_cents bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  visits integer NOT NULL DEFAULT 0,
  max_uses integer,
  uses_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_links_slug_idx
  ON payment_links (agency_id, location_id, slug);

ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_links_tenant_scope ON payment_links;
CREATE POLICY payment_links_tenant_scope ON payment_links
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

CREATE TABLE IF NOT EXISTS coupons (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  discount_type text NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent', 'fixed')),
  discount_value integer NOT NULL CHECK (discount_value >= 0),
  active boolean NOT NULL DEFAULT true,
  max_uses integer,
  uses_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_idx
  ON coupons (agency_id, location_id, upper(code));

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coupons_tenant_scope ON coupons;
CREATE POLICY coupons_tenant_scope ON coupons
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

CREATE TABLE IF NOT EXISTS dunning_attempts (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  payment_id uuid,
  attempt_number integer NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'processing', 'succeeded', 'failed_retryable', 'failed_terminal', 'cancelled')),
  failure_code text,
  failure_message text,
  idempotency_key text NOT NULL,
  next_retry_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS dunning_attempts_idempotency_idx
  ON dunning_attempts (agency_id, location_id, idempotency_key);
CREATE INDEX IF NOT EXISTS dunning_attempts_due_idx
  ON dunning_attempts (agency_id, location_id, status, next_retry_at);

ALTER TABLE dunning_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE dunning_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dunning_attempts_tenant_scope ON dunning_attempts;
CREATE POLICY dunning_attempts_tenant_scope ON dunning_attempts
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON stripe_connect_accounts, payment_links, coupons, dunning_attempts TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON stripe_connect_accounts, payment_links, coupons, dunning_attempts TO operza_worker;
  END IF;
END $$;
