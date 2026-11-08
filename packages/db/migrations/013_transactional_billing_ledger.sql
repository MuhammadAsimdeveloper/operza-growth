-- Migration 013: Transactional Billing Ledger & Credit Accounting
-- Scoped to Agency & Location with Forced PostgreSQL Row-Level Security

CREATE TABLE IF NOT EXISTS billing_ledger_accounts (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('credit_balance', 'stripe_escrow', 'provider_cost_accrual', 'usage_reserve')),
  balance_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS billing_accounts_tenant_idx
  ON billing_ledger_accounts (agency_id, location_id, account_type);

CREATE TABLE IF NOT EXISTS billing_ledger_entries (
  id uuid NOT NULL,
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  account_id uuid NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('credit', 'debit')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  running_balance_cents bigint NOT NULL,
  reference_type text NOT NULL CHECK (reference_type IN ('copilot_token_usage', 'workflow_action', 'stripe_topup', 'manual_adjustment', 'refund')),
  reference_id text NOT NULL,
  description text NOT NULL DEFAULT '',
  checksum varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, account_id) REFERENCES billing_ledger_accounts(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS billing_entries_account_idx
  ON billing_ledger_entries (agency_id, location_id, account_id, created_at DESC);

-- Enable and force Row-Level Security
ALTER TABLE billing_ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_ledger_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_ledger_accounts_tenant_scope ON billing_ledger_accounts;
CREATE POLICY billing_ledger_accounts_tenant_scope ON billing_ledger_accounts
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

ALTER TABLE billing_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_ledger_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_ledger_entries_tenant_scope ON billing_ledger_entries;
CREATE POLICY billing_ledger_entries_tenant_scope ON billing_ledger_entries
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );
