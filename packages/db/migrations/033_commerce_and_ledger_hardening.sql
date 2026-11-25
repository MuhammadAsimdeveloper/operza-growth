-- Migration 033: Commerce Tables (Orders, Invoices, Payments) & Billing Ledger Hardening
-- Scoped to Agency & Location with Forced PostgreSQL Row-Level Security and Least-Privilege Grants

-- 1. Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  order_number text NOT NULL CHECK (length(order_number) BETWEEN 1 AND 64),
  contact_id uuid,
  opportunity_id uuid,
  invoice_id uuid,
  payment_link_id uuid,
  contact_name text,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  original_amount_cents bigint NOT NULL DEFAULT 0 CHECK (original_amount_cents >= 0),
  discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'completed', 'failed', 'cancelled', 'refunded', 'partially_refunded')),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  coupon_code text,
  idempotency_key text,
  source text,
  has_upsell boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS orders_location_created_idx
  ON orders (agency_id, location_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_idx
  ON orders (agency_id, location_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_tenant_scope ON orders;
CREATE POLICY orders_tenant_scope ON orders
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- 2. Invoices Table
CREATE TABLE IF NOT EXISTS invoices (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  invoice_number text NOT NULL CHECK (length(invoice_number) BETWEEN 1 AND 64),
  order_id uuid,
  contact_id uuid,
  contact_name text,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  paid_cents bigint NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  tax_cents bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'void', 'cancelled')),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  due_date date,
  description text,
  payment_method text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS invoices_location_created_idx
  ON invoices (agency_id, location_id, created_at DESC);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_tenant_scope ON invoices;
CREATE POLICY invoices_tenant_scope ON invoices
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- 3. Payments Table
CREATE TABLE IF NOT EXISTS payments (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  order_id uuid,
  invoice_id uuid,
  contact_id uuid,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  refunded_cents bigint NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded')),
  provider text NOT NULL DEFAULT 'simulated',
  provider_payment_id text,
  provider_event_id text,
  idempotency_key text,
  method text,
  failure_code text,
  failure_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS payments_location_created_idx
  ON payments (agency_id, location_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_idx
  ON payments (agency_id, location_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_event_idx
  ON payments (agency_id, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_tenant_scope ON payments;
CREATE POLICY payments_tenant_scope ON payments
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

-- 4. Harden Billing Ledger (Migration 013) with idempotency_key and commerce reference types
ALTER TABLE billing_ledger_entries
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS billing_ledger_entries_idempotency_idx
  ON billing_ledger_entries (agency_id, location_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE billing_ledger_entries
  DROP CONSTRAINT IF EXISTS billing_ledger_entries_reference_type_check;
ALTER TABLE billing_ledger_entries
  ADD CONSTRAINT billing_ledger_entries_reference_type_check
  CHECK (reference_type IN (
    'copilot_token_usage', 'workflow_action', 'stripe_topup',
    'manual_adjustment', 'refund', 'order_payment', 'invoice_payment', 'upsell_payment'
  ));

-- 5. Least-privilege runtime grants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON orders, invoices TO operza_app;
    GRANT SELECT, INSERT, UPDATE ON payments, billing_ledger_accounts TO operza_app;
    GRANT SELECT, INSERT ON billing_ledger_entries TO operza_app;
  END IF;
END $$;
