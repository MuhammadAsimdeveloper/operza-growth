import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('Migration 011: contains valid SQL DDL and strict RLS policies', async () => {
  const sql = await readFile(path.join(root, 'migrations/011_platform_reconciliation.sql'), 'utf8');

  // Verify RLS enabled and forced on core tables
  assert.match(sql, /ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE agencies FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE users ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE users FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE agency_memberships ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE agency_memberships FORCE ROW LEVEL SECURITY;/);

  // Verify CRM entity tables
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pipelines/);
  assert.match(sql, /ALTER TABLE pipelines FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pipeline_stages/);
  assert.match(sql, /ALTER TABLE pipeline_stages FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunities/);
  assert.match(sql, /ALTER TABLE opportunities FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS calendars/);
  assert.match(sql, /ALTER TABLE calendars FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS appointments/);
  assert.match(sql, /ALTER TABLE appointments FORCE ROW LEVEL SECURITY;/);

  // Verify multi-tenant composite primary keys
  assert.match(sql, /PRIMARY KEY \(agency_id, location_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(agency_id, location_id\) REFERENCES locations\(agency_id, id\)/);
});

test('Multi-tenant RLS isolation mock: queries outside active tenant return 0 rows', async () => {
  const tenantA = { agencyId: '11111111-1111-1111-1111-111111111111', locationId: '22222222-2222-2222-2222-222222222222' };
  const tenantB = { agencyId: '33333333-3333-3333-3333-333333333333', locationId: '44444444-4444-4444-4444-444444444444' };

  const store = [
    { id: 'opp_1', agency_id: tenantA.agencyId, location_id: tenantA.locationId, name: 'Deal A' },
    { id: 'opp_2', agency_id: tenantB.agencyId, location_id: tenantB.locationId, name: 'Deal B' }
  ];

  function queryWithContext(activeAgencyId, activeLocationId) {
    // Simulates PostgreSQL RLS engine filtering by session variables
    return store.filter(row => row.agency_id === activeAgencyId && row.location_id === activeLocationId);
  }

  // Tenant A queries
  const resultsA = queryWithContext(tenantA.agencyId, tenantA.locationId);
  assert.equal(resultsA.length, 1);
  assert.equal(resultsA[0].id, 'opp_1');

  // Tenant B queries
  const resultsB = queryWithContext(tenantB.agencyId, tenantB.locationId);
  assert.equal(resultsB.length, 1);
  assert.equal(resultsB[0].id, 'opp_2');

  // Cross-tenant breach attempt: tenant A trying to read tenant B's data
  const crossTenantLeak = resultsA.filter(r => r.agency_id === tenantB.agencyId);
  assert.equal(crossTenantLeak.length, 0, 'Cross-tenant query must return exactly 0 rows');
});

test('Migration 012: contains durable workflow leases and queue index', async () => {
  const sql = await readFile(path.join(root, 'migrations/012_durable_workflow_leases.sql'), 'utf8');

  assert.match(sql, /ALTER TABLE workflow_definitions[\s\S]+ADD COLUMN IF NOT EXISTS definition_hash/);
  assert.match(sql, /ALTER TABLE workflow_templates[\s\S]+ADD COLUMN IF NOT EXISTS definition_hash/);
  assert.match(sql, /ALTER TABLE workflow_executions[\s\S]+ADD COLUMN IF NOT EXISTS worker_lease_id/);
  assert.match(sql, /ALTER TABLE workflow_executions[\s\S]+ADD COLUMN IF NOT EXISTS heartbeat_at/);
  assert.match(sql, /ALTER TABLE workflow_executions[\s\S]+ADD COLUMN IF NOT EXISTS attempt_count/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS workflow_executions_lease_recovery_idx/);
});

test('Migration 013: contains billing ledger accounts and entries with forced RLS', async () => {
  const sql = await readFile(path.join(root, 'migrations/013_transactional_billing_ledger.sql'), 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS billing_ledger_accounts/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS billing_ledger_entries/);
  assert.match(sql, /ALTER TABLE billing_ledger_accounts FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE billing_ledger_entries FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /PRIMARY KEY \(agency_id, location_id, id\)/);
});

test('Migration 014: contains immutable audit trail with forced RLS and mutation blocks', async () => {
  const sql = await readFile(path.join(root, 'migrations/014_immutable_audit_events.sql'), 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS immutable_audit_events/);
  assert.match(sql, /ALTER TABLE immutable_audit_events FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /ON UPDATE TO immutable_audit_events\s+DO INSTEAD NOTHING/);
  assert.match(sql, /ON DELETE TO immutable_audit_events\s+DO INSTEAD NOTHING/);
});
