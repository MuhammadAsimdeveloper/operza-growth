import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresSecretBackend, parseTenantSecretRef } from '../lib/secret-vault-repository.mjs';

const tenantId = '1b5a57d4-5ae3-4cf1-9a4c-4da651aaf001';
const locationId = '2c6b68e5-6bf4-4d02-8b5d-5eb762bbf002';
const ref = `vault:${tenantId}/${locationId}/microsoft/outlook/tokens`;

test('tenant vault references require real tenant and location UUIDs', () => {
  assert.deepEqual(parseTenantSecretRef(ref), { tenantId, locationId });
  assert.throws(() => parseTenantSecretRef('vault:agency-one/location-one/key'), { code: 'INVALID_SECRET_REFERENCE' });
  assert.throws(() => parseTenantSecretRef(`vault:${tenantId}/${locationId}/../other-tenant/key`), { code: 'INVALID_SECRET_REFERENCE' });
});

test('PostgreSQL backend persists ciphertext under transaction-local tenant context', async () => {
  const records = new Map();
  const client = {
    context: null,
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.includes('set_config')) {
        this.context = { tenantId: params[0], locationId: params[1] };
        return { rowCount: 1, rows: [] };
      }
      const key = params[2];
      if (sql.startsWith('INSERT INTO provider_secrets')) {
        records.set(key, { ...this.context, value: params[3] });
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith('SELECT encrypted_value')) {
        const row = records.get(key);
        return { rowCount: row && row.tenantId === this.context.tenantId && row.locationId === this.context.locationId ? 1 : 0,
          rows: row && row.tenantId === this.context.tenantId && row.locationId === this.context.locationId ? [{ encrypted_value: row.value }] : [] };
      }
      if (sql.startsWith('SELECT 1')) {
        const row = records.get(key);
        return { rowCount: row && row.tenantId === this.context.tenantId && row.locationId === this.context.locationId ? 1 : 0, rows: [{}] };
      }
      if (sql.startsWith('DELETE')) {
        const row = records.get(key);
        const matched = row && row.tenantId === this.context.tenantId && row.locationId === this.context.locationId;
        if (matched) records.delete(key);
        return { rowCount: matched ? 1 : 0, rows: [] };
      }
      throw new Error('Unexpected SQL in test: ' + sql);
    },
    release() {}
  };
  const pool = { async connect() { return client; } };
  const backend = createPostgresSecretBackend(pool);
  const encrypted = 'v1:salthex:ivhex:taghex:ciphertext';
  await backend.set(ref, encrypted);
  assert.equal(await backend.get(ref), encrypted);
  assert.equal(await backend.has(ref), true);
  assert.equal(await backend.delete(ref), true);
  assert.equal(await backend.get(ref), null);
});

test('PostgreSQL backend never persists raw plaintext values', async () => {
  const backend = createPostgresSecretBackend({ connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }) });
  await assert.rejects(() => backend.set(ref, 'plain-api-key'), { code: 'ENCRYPTED_VALUE_REQUIRED' });
});
