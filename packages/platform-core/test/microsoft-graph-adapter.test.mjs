import test from 'node:test';
import assert from 'node:assert/strict';
import { createMicrosoftGraphEmailAdapter } from '../src/microsoft-graph-adapter.mjs';

function mockMicrosoftFetch({ user = { id: 'graph-user-1', mail: 'owner@example.test' } } = {}) {
  const requests = [];
  const fetchFn = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/oauth2/v2.0/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'fresh-access-token',
          refresh_token: 'rotated-refresh-token',
          expires_in: 3600
        })
      };
    }
    if (url.includes('/v1.0/me/sendMail')) {
      return { ok: true, status: 202, json: async () => ({}) };
    }
    if (url.includes('/v1.0/me')) {
      return { ok: true, status: 200, json: async () => user };
    }
    throw new Error('Unexpected Microsoft Graph test request: ' + url);
  };
  return { fetchFn, requests };
}

test('Microsoft Graph email adapter verifies the delegated mailbox and persists rotated refresh tokens', async () => {
  const { fetchFn, requests } = mockMicrosoftFetch();
  const saved = [];
  const adapter = createMicrosoftGraphEmailAdapter({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    secretResolver: { store: async (ref, token) => saved.push({ ref, token }) },
    fetchFn
  });

  const result = await adapter.verify({
    secret: 'old-refresh-token',
    secretRef: 'vault:agency-id/location-id/microsoft-graph-refresh-token',
    tenantId: 'agency-id',
    locationId: 'location-id'
  });

  assert.equal(result.verified, true);
  assert.equal(result.accountId, 'graph-user-1');
  assert.equal(result.senderEmail, 'owner@example.test');
  assert.deepEqual(saved, [{
    ref: 'vault:agency-id/location-id/microsoft-graph-refresh-token',
    token: 'rotated-refresh-token'
  }]);
  assert.ok(requests.some(request => request.url.endsWith('/v1.0/me?$select=id,displayName,givenName,surname,mail,userPrincipalName')));
});

test('Microsoft Graph email adapter refuses delivery without granted consent', async () => {
  let fetched = false;
  const adapter = createMicrosoftGraphEmailAdapter({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetchFn: async () => { fetched = true; throw new Error('should not fetch'); }
  });

  const result = await adapter.dispatch({
    secret: 'refresh-token',
    payload: { to: 'customer@example.test', subject: 'Hello', body: 'Test' },
    consent: { status: 'revoked' }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONSENT_REQUIRED');
  assert.equal(fetched, false);
});

test('Microsoft Graph email adapter sends through Graph and reports accepted, not delivered', async () => {
  const { fetchFn, requests } = mockMicrosoftFetch();
  const saved = [];
  const adapter = createMicrosoftGraphEmailAdapter({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    secretResolver: { store: async (ref, token) => saved.push({ ref, token }) },
    fetchFn
  });

  const result = await adapter.dispatch({
    secret: 'old-refresh-token',
    secretRef: 'vault:agency-id/location-id/microsoft-graph-refresh-token',
    tenantId: 'agency-id',
    locationId: 'location-id',
    payload: { to: ['customer@example.test'], subject: 'Welcome', body: 'Hello' },
    consent: { status: 'granted' }
  });

  const sendRequest = requests.find(request => request.url.endsWith('/v1.0/me/sendMail'));
  assert.ok(sendRequest);
  assert.equal(JSON.parse(sendRequest.options.body).message.subject, 'Welcome');
  assert.equal(result.ok, true);
  assert.equal(result.accepted, true);
  assert.equal(result.delivered, false);
  assert.equal(result.statusCode, 202);
  assert.deepEqual(saved, [{
    ref: 'vault:agency-id/location-id/microsoft-graph-refresh-token',
    token: 'rotated-refresh-token'
  }]);
});
