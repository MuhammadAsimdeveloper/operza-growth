import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformRepository } from '../lib/platform-repository.mjs';

const requiredTables = [
  'provider_connections', 'communication_consents', 'workflow_approvals',
  'workflow_action_receipts', 'workflow_outbox', 'tenant_entitlements',
  'usage_events', 'copilot_proposals'
];

function readinessPool({ missing = [], superuser = false, bypassRls = false } = {}) {
  return {
    async connect() { return { release() {} }; },
    async query(sql) {
      if (sql.includes('information_schema.tables')) {
        return {
          rows: requiredTables.filter(name => !missing.includes(name)).map(table_name => ({ table_name }))
        };
      }
      if (sql.includes('FROM pg_roles')) {
        return { rows: [{ rolsuper: superuser, rolbypassrls: bypassRls }] };
      }
      if (sql.includes('LEFT JOIN pg_policies')) {
        return {
          rows: requiredTables.filter(name => !missing.includes(name)).map(table_name => ({
            table_name, rls_enabled: true, rls_forced: true, policy_count: 1
          }))
        };
      }
      throw new Error('Unexpected readiness query');
    }
  };
}

test('normalized platform mode requires every control-plane table and an RLS-bound runtime role', async () => {
  const result = await createPlatformRepository(readinessPool()).checkReady();
  assert.equal(result.ready, true);
  assert.deepEqual(result.tables, requiredTables);
});

test('normalized platform mode refuses missing migrations', async () => {
  await assert.rejects(
    createPlatformRepository(readinessPool({ missing: ['copilot_proposals'] })).checkReady(),
    { code: 'PLATFORM_SCHEMA_INCOMPLETE' }
  );
});

test('normalized platform mode refuses superuser and BYPASSRLS database roles', async () => {
  await assert.rejects(
    createPlatformRepository(readinessPool({ superuser: true })).checkReady(),
    { code: 'PLATFORM_ROLE_BYPASSES_RLS' }
  );
  await assert.rejects(
    createPlatformRepository(readinessPool({ bypassRls: true })).checkReady(),
    { code: 'PLATFORM_ROLE_BYPASSES_RLS' }
  );
});

test('normalized platform mode refuses tables without forced RLS policies', async () => {
  const pool = readinessPool();
  pool.query = async sql => {
    if (sql.includes('information_schema.tables')) return { rows: requiredTables.map(table_name => ({ table_name })) };
    if (sql.includes('FROM pg_roles')) return { rows: [{ rolsuper: false, rolbypassrls: false }] };
    if (sql.includes('LEFT JOIN pg_policies')) {
      return { rows: requiredTables.map((table_name, index) => ({
        table_name, rls_enabled: true, rls_forced: index !== 0, policy_count: 1
      })) };
    }
    throw new Error('Unexpected readiness query');
  };
  await assert.rejects(
    createPlatformRepository(pool).checkReady(),
    { code: 'PLATFORM_RLS_INCOMPLETE' }
  );
});
