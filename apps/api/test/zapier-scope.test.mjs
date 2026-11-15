import test from 'node:test';
import assert from 'node:assert/strict';
import { handleZapierRoute } from '../zapier-router.mjs';

async function invokeZapierRoute({ method = 'GET', pathname, scopes, apiKey = true, body } = {}) {
  let response;
  const actor = {
    user: { id: 'user_test', email: 'zapier-test@operza.test' },
    ...(apiKey ? { apiKey: { id: 'key_test', scopes } } : {})
  };
  const state = {
    records: { contacts: [] },
    zapierHookSubscriptions: [],
    zapierHookDeliveries: []
  };
  await handleZapierRoute({}, {}, {
    method,
    pathname,
    actor,
    agency: { id: 'agency_test', name: 'Test Agency' },
    activeLocation: { id: 'location_test' },
    state,
    saveState: async () => {},
    sendJson: (_res, status, payload) => {
      response = { status, payload };
      return response;
    },
    readBody: async () => body || ({
      event: 'contact.created',
      target_url: 'https://hooks.example.test/operza'
    }),
    executeWorkflowInstance: async () => ({ id: 'run_test', status: 'completed' }),
    broadcast: () => {}
  });
  return { ...response, state };
}

test('API keys without webhooks:manage cannot list Zapier hook subscriptions', async () => {
  const response = await invokeZapierRoute({
    pathname: '/api/v1/zapier/hooks',
    scopes: ['contacts:read']
  });

  assert.equal(response.status, 403);
  assert.equal(response.payload.code, 'API_SCOPE_REQUIRED');
});

test('API keys with webhooks:manage can list Zapier hook subscriptions', async () => {
  const response = await invokeZapierRoute({
    pathname: '/api/v1/zapier/hooks',
    scopes: ['webhooks:manage']
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.payload.subscriptions, []);
});

test('Zapier contact polling requires contacts:read', async () => {
  const denied = await invokeZapierRoute({
    pathname: '/api/v1/zapier/polls/contact.created',
    scopes: ['opportunities:read']
  });
  const allowed = await invokeZapierRoute({
    pathname: '/api/v1/zapier/polls/contact.created',
    scopes: ['contacts:read']
  });

  assert.equal(denied.status, 403);
  assert.equal(allowed.status, 200);
});

test('Zapier contact creation requires contacts:write', async () => {
  const denied = await invokeZapierRoute({
    method: 'POST',
    pathname: '/api/v1/zapier/actions/create_contact',
    scopes: ['contacts:read']
  });

  assert.equal(denied.status, 403);
  assert.equal(denied.payload.code, 'API_SCOPE_REQUIRED');
  assert.deepEqual(denied.state.records.contacts, []);
});

test('Zapier authentication reports the API key assigned scopes, not a fixed privilege list', async () => {
  const scopes = ['contacts:read', 'webhooks:manage'];
  const response = await invokeZapierRoute({
    pathname: '/api/v1/zapier/auth/me',
    scopes
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.payload.scopes, scopes);
});

test('Cookie-authenticated Operza users retain normal access to Zapier routes', async () => {
  const response = await invokeZapierRoute({
    pathname: '/api/v1/zapier/hooks',
    apiKey: false
  });

  assert.equal(response.status, 200);
});

test('Zapier communication actions never claim delivery without a verified provider', async () => {
  const response = await invokeZapierRoute({
    method: 'POST',
    pathname: '/api/v1/zapier/actions/send_communication',
    scopes: ['communications:dispatch'],
    body: { recipient: 'customer@example.test', channel: 'email', message: 'Hello' }
  });

  assert.equal(response.status, 501);
  assert.equal(response.payload.code, 'PROVIDER_NOT_CONFIGURED');
  assert.equal(response.payload.success, false);
});
