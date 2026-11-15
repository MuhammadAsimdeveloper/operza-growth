import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowProviderExecutor } from '../src/provider-dispatch.mjs';

const connection = {
  id: 'provider_connection_001',
  tenantId: 'tenant_001',
  locationId: 'location_001',
  providerKey: 'email.microsoft_graph',
  channel: 'email',
  secretRef: 'vault:tenant_001/location_001/microsoft-refresh',
  status: 'verified',
  revokedAt: null
};
const consent = {
  id: 'consent_001',
  tenantId: 'tenant_001',
  locationId: 'location_001',
  contactId: 'contact_001',
  channel: 'email',
  purpose: 'transactional',
  status: 'granted',
  source: 'manual',
  capturedAt: new Date().toISOString(),
  expiresAt: null
};
const invocation = {
  tenantId: 'tenant_001',
  locationId: 'location_001',
  providerConnectionId: connection.id,
  providerKey: 'email',
  consentId: consent.id,
  actionHash: 'a'.repeat(64)
};

function createExecutor(overrides = {}) {
  const calls = [];
  const executor = createWorkflowProviderExecutor({
    getConnection: async () => connection,
    listConsents: async () => [consent],
    secretResolver: { resolve: async () => 'server-only-refresh-token' },
    adapterRegistry: {
      get: () => ({
        providerKey: 'email.microsoft_graph',
        liveDispatch: true,
        dispatch: async (input) => {
          calls.push(input);
          return { ok: true, accepted: true, delivered: false, statusCode: 202, provider: 'microsoft_graph' };
        }
      })
    },
    renderTemplate: (value) => value,
    ...overrides
  });
  return { executor, calls };
}

test('provider executor rechecks tenant, location, current consent, vault secret and the real adapter', async () => {
  const { executor, calls } = createExecutor();
  const result = await executor({
    invocation,
    node: { id: 'node_email', type: 'send_email', config: { to: 'person@example.com', subject: 'Hi', body: 'Hello' } },
    context: { contact: { id: 'contact_001', email: 'person@example.com' } },
    idempotencyKey: invocation.actionHash
  });

  assert.equal(result.accepted, true);
  assert.equal(result.delivered, false);
  assert.equal(result.provider, 'microsoft_graph');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].secret, 'server-only-refresh-token');
  assert.equal(calls[0].consent.id, consent.id);
  assert.equal(calls[0].payload.to, 'person@example.com');
  assert.equal(calls[0].payload.subject, 'Hi');
  assert.equal(calls[0].idempotencyKey, invocation.actionHash);
});

test('provider executor denies a replaced or revoked consent before calling the adapter', async () => {
  const revoked = { ...consent, status: 'revoked' };
  const { executor, calls } = createExecutor({
    listConsents: async () => [revoked]
  });

  await assert.rejects(
    () => executor({
      invocation,
      node: { id: 'node_email', type: 'send_email', config: { to: 'person@example.com', subject: 'Hi', body: 'Hello' } },
      context: { contact: { id: 'contact_001', email: 'person@example.com' } }
    }),
    error => error.code === 'CONSENT_REVOKED'
  );
  assert.equal(calls.length, 0);
});

test('provider executor refuses cross-tenant or unverified connections', async () => {
  const { executor, calls } = createExecutor({
    getConnection: async () => ({ ...connection, tenantId: 'tenant_other' })
  });

  await assert.rejects(
    () => executor({
      invocation,
      node: { id: 'node_email', type: 'send_email', config: { to: 'person@example.com', subject: 'Hi', body: 'Hello' } },
      context: { contact: { id: 'contact_001', email: 'person@example.com' } }
    }),
    error => error.code === 'PROVIDER_CONNECTION_SCOPE_MISMATCH'
  );
  assert.equal(calls.length, 0);
});

test('provider executor does not select simulated adapters for live sending', async () => {
  const { executor, calls } = createExecutor({
    adapterRegistry: { get: () => ({ providerKey: 'email.microsoft_graph', dispatch: async () => ({ ok: true }) }) }
  });

  await assert.rejects(
    () => executor({
      invocation,
      node: { id: 'node_email', type: 'send_email', config: { to: 'person@example.com', subject: 'Hi', body: 'Hello' } },
      context: { contact: { id: 'contact_001', email: 'person@example.com' } }
    }),
    error => error.code === 'PROVIDER_ADAPTER_UNAVAILABLE'
  );
  assert.equal(calls.length, 0);
});

test('provider executor requires the consent record ID to match the approval-bound consent ID', async () => {
  const { executor, calls } = createExecutor({
    listConsents: async () => [{ ...consent, id: 'consent_replaced' }]
  });

  await assert.rejects(
    () => executor({
      invocation,
      node: { id: 'node_email', type: 'send_email', config: { to: 'person@example.com', subject: 'Hi', body: 'Hello' } },
      context: { contact: { id: 'contact_001', email: 'person@example.com' } }
    }),
    error => error.code === 'CONSENT_CHANGED'
  );
  assert.equal(calls.length, 0);
});
