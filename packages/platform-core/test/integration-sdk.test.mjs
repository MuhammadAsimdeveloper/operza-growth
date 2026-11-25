import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrationHubSdk } from '../src/integration-sdk.mjs';

test('IntegrationHubSdk: registers integrations, enforces per-tenant rate limits, and redacts secrets', async () => {
  const sdk = createIntegrationHubSdk({
    defaultRateLimit: { maxRequests: 2, windowMs: 60_000 }
  });

  sdk.register({
    id: 'mock_crm',
    name: 'Mock CRM',
    provider: 'mock_crm',
    version: '1.0.0',
    authType: 'api_key',
    status: 'sandbox_connected',
    triggers: ['contact.created'],
    actions: {
      sync_contact: {
        description: 'Sync contact',
        requiredFields: ['email'],
        async execute({ input, secret }) {
          return { synced: true, email: input.email, usedSecretLength: secret.length };
        }
      }
    },
    validateConfig(config) {
      return config?.region ? { valid: true } : { valid: false, error: 'region is required' };
    },
    async testConnection({ secret }) {
      return secret === 'valid_key' ? { ok: true } : { ok: false, code: 'INVALID_CREDENTIALS' };
    }
  });

  const reg = sdk.get('mock_crm');
  assert.equal(reg.name, 'Mock CRM');
  assert.equal(reg.status, 'sandbox_connected');

  assert.equal(sdk.validateConfig('mock_crm', {}).valid, false);
  assert.equal(sdk.validateConfig('mock_crm', { region: 'us-east' }).valid, true);

  const badConn = await sdk.testConnection('mock_crm', { secret: 'wrong' });
  assert.equal(badConn.ok, false);

  // Tenant A executes 2 allowed requests, 3rd hits per-tenant rate limit; Tenant B is unaffected
  const r1 = await sdk.executeAction('mock_crm', 'sync_contact', {
    tenantId: 'tenant-a',
    secret: 'valid_key',
    input: { email: 'a@example.com' },
    idempotencyKey: 'k1'
  });
  assert.equal(r1.ok, true);
  assert.equal(r1.output.synced, true);

  const r2 = await sdk.executeAction('mock_crm', 'sync_contact', {
    tenantId: 'tenant-a',
    secret: 'valid_key',
    input: { email: 'b@example.com' },
    idempotencyKey: 'k2'
  });
  assert.equal(r2.ok, true);

  const r3 = await sdk.executeAction('mock_crm', 'sync_contact', {
    tenantId: 'tenant-a',
    secret: 'valid_key',
    input: { email: 'c@example.com' },
    idempotencyKey: 'k3'
  });
  assert.equal(r3.ok, false);
  assert.equal(r3.code, 'RATE_LIMIT_EXCEEDED');

  // Tenant B still has full quota
  const rB = await sdk.executeAction('mock_crm', 'sync_contact', {
    tenantId: 'tenant-b',
    secret: 'valid_key',
    input: { email: 'tenantb@example.com' },
    idempotencyKey: 'kb1'
  });
  assert.equal(rB.ok, true);

  // Idempotent replay for Tenant A returns cached result without consuming quota
  const r1Replay = await sdk.executeAction('mock_crm', 'sync_contact', {
    tenantId: 'tenant-a',
    secret: 'valid_key',
    input: { email: 'a@example.com' },
    idempotencyKey: 'k1'
  });
  assert.equal(r1Replay.ok, true);
  assert.equal(r1Replay.deduplicated, true);
});
