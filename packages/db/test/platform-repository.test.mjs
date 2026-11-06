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
    async query(sql) {
      if (sql.includes('information_schema.tables')) {
        return {
          rows: requiredTables.filter(name => !missing.includes(name)).map(table_name => ({ table_name }))
        };
      }
      if (sql.includes('FROM pg_roles')) {
        return { rows: [{ rolsuper: superuser, rolbypassrls: bypassRls }] };
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
