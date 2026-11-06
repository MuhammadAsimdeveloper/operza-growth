import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProviderConnection, verifyProviderConnection, revokeProviderConnection,
  providerMayDispatch, publicProviderConnection, PROVIDER_CATALOG
} from '../src/provider-lifecycle.mjs';

const identity = {
  tenantId: 'tenant_001',
  locationId: 'location_001',
  providerKey: 'sms.twilio',
  secretRef: 'env:TWILIO_AUTH_TOKEN'
};

test('creates a pending connection using a secret reference and no secret value', () => {
  const connection = createProviderConnection(identity, { id: 'connection_001', now: 1_700_000_000_000 });
  assert.equal(connection.status, 'pending_verification');
  assert.equal(connection.secretRef, 'env:TWILIO_AUTH_TOKEN');
  assert.equal(providerMayDispatch(connection), false);
  assert.equal(JSON.stringify(publicProviderConnection(connection)).includes('TWILIO_AUTH_TOKEN'), false);
  assert.equal(PROVIDER_CATALOG.some(item => item.key === 'payments.stripe'), true);
});

test('rejects raw secrets and unknown provider config fields', () => {
  assert.throws(() => createProviderConnection({ ...identity, secretRef: 'actual-secret-value' }), { code: 'INVALID_SECRET_REFERENCE' });
  assert.throws(() => createProviderConnection({ ...identity, config: { apiKey: 'leak' } }), { code: 'INVALID_PROVIDER_CONFIG' });
});

test('verification requires an injected matching provider adapter and secret resolver', async () => {
  const connection = createProviderConnection(identity, { id: 'connection_002' });
  const noAdapter = await verifyProviderConnection(connection, {});
  assert.equal(noAdapter.code, 'SECRET_RESOLVER_UNAVAILABLE');
  const verified = await verifyProviderConnection(connection, {
    secretResolver: { resolve: async ref => ref === identity.secretRef ? 'server-only-secret' : null },
    adapter: { id: 'twilio-verifier', providerKey: 'sms.twilio', verify: async ({ secret }) => ({ verified: secret === 'server-only-secret' }) }
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.connection.status, 'verified');
  assert.equal(providerMayDispatch(verified.connection), true);
  assert.equal(JSON.stringify(verified).includes('server-only-secret'), false);
});

test('revocation is terminal and prevents dispatch', () => {
  const connection = createProviderConnection(identity, { id: 'connection_003' });
  const revoked = revokeProviderConnection(connection, { now: 1_700_000_000_000 });
  assert.equal(revoked.status, 'revoked');
  assert.equal(providerMayDispatch(revoked), false);
});
