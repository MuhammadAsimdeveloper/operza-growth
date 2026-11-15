import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresSecretStorage } from '../lib/provider-secret-storage.mjs';

const agencyId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';
const secretRef = `vault:${agencyId}/${locationId}/outlook-refresh-token`;

function createFakePool() {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.includes('set_config')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT encrypted_value')) {
        return { rowCount: 1, rows: [{ encrypted_value: 'v1:' + 'a'.repeat(100) }] };
      }
      if (sql.includes('INSERT INTO provider_secrets')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT 1 FROM provider_secrets')) return { rowCount: 1, rows: [{ one: 1 }] };
      if (sql.includes('DELETE FROM provider_secrets')) return { rowCount: 1, rows: [] };
      throw new Error('Unexpected SQL: ' + sql);
    },
    release() {}
  };
  return { calls, async connect() { return client; } };
}

test('PostgreSQL secret storage scopes every operation to the vault reference tenant', async () => {
  const pool = createFakePool();
  const storage = createPostgresSecretStorage(pool);
  const envelope = 'v1:' + 'b'.repeat(100);

  assert.equal(storage.durable, true);
  await storage.set(secretRef, envelope);
  assert.equal(await storage.get(secretRef), 'v1:' + 'a'.repeat(100));
  assert.equal(await storage.has(secretRef), true);
  assert.equal(await storage.delete(secretRef), true);

  const scopedCalls = pool.calls.filter(call => call.sql.includes("set_config('app.agency_id'"));
  assert.equal(scopedCalls.length, 4);
  for (const call of scopedCalls) {
    assert.deepEqual(call.params, [agencyId, locationId]);
  }
});

test('PostgreSQL secret storage rejects unscoped refs and plaintext payloads', async () => {
  const storage = createPostgresSecretStorage(createFakePool());
  await assert.rejects(storage.get('vault:tenant-alpha/key'), { code: 'INVALID_VAULT_REFERENCE' });
  await assert.rejects(storage.set(secretRef, 'plaintext-secret'), { code: 'INVALID_SECRET_CIPHERTEXT' });
});
