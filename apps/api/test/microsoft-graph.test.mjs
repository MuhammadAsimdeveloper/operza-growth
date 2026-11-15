import test from 'node:test';
import assert from 'node:assert/strict';
import { createMicrosoftGraphClient, createMicrosoftGraphProviderAdapter } from '../integrations/microsoft-graph.mjs';

const tokenResponse = {
  token_type: 'Bearer',
  scope: 'User.Read Mail.Send',
  expires_in: 3600,
  access_token: 'access-test-token',
  refresh_token: 'refresh-test-token'
};

test('Microsoft OAuth authorization URL uses state and PKCE S256', () => {
  const client = createMicrosoftGraphClient({
    clientId: 'client-id',
    redirectUri: 'https://operza.example/api/integrations/outlook/callback'
  });
  const url = new URL(client.buildAuthorizationUrl({
    state: 'opaque-csrf-state',
    codeChallenge: 'pkce-challenge'
  }));
  assert.equal(url.origin, 'https://login.microsoftonline.com');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'opaque-csrf-state');
  assert.equal(url.searchParams.get('code_challenge'), 'pkce-challenge');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('scope').includes('offline_access'));
  assert.ok(url.searchParams.get('scope').includes('Mail.Send'));
});

test('Microsoft OAuth code exchange sends the PKCE verifier and keeps credentials server-side', async () => {
  let request;
  const client = createMicrosoftGraphClient({
    clientId: 'client-id',
    clientSecret: 'server-only-secret',
    redirectUri: 'https://operza.example/callback',
    fetchFn: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => tokenResponse };
    }
  });
  const result = await client.exchangeCode({ code: 'auth-code', codeVerifier: 'pkce-verifier' });
  const body = new URLSearchParams(request.options.body);
  assert.match(request.url, /oauth2\/v2\.0\/token$/);
  assert.equal(body.get('code'), 'auth-code');
  assert.equal(body.get('code_verifier'), 'pkce-verifier');
  assert.equal(body.get('client_secret'), 'server-only-secret');
  assert.equal(result.refresh_token, 'refresh-test-token');
});

test('Microsoft Graph sendMail posts to the signed-in user endpoint and reports accepted, not delivered', async () => {
  let request;
  const client = createMicrosoftGraphClient({
    clientId: 'client-id',
    redirectUri: 'https://operza.example/callback',
    fetchFn: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 202, headers: { get: (name) => name.toLowerCase() === 'request-id' ? 'graph-request-1' : null } };
    }
  });
  const result = await client.sendMail({
    accessToken: 'access-token',
    to: ['lead@example.com'],
    subject: 'Your consultation',
    body: 'Thank you for your interest.',
    bodyType: 'Text'
  });
  assert.equal(request.url, 'https://graph.microsoft.com/v1.0/me/sendMail');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.message.toRecipients[0].emailAddress.address, 'lead@example.com');
  assert.equal(result.status, 'accepted');
  assert.equal(result.requestId, 'graph-request-1');
  assert.notEqual(result.status, 'delivered');
});

test('Microsoft Graph sendMail rejects non-202 responses without fabricating a message ID', async () => {
  const client = createMicrosoftGraphClient({
    clientId: 'client-id',
    redirectUri: 'https://operza.example/callback',
    fetchFn: async () => ({ ok: false, status: 403, text: async () => 'Forbidden' })
  });
  await assert.rejects(client.sendMail({
    accessToken: 'access-token',
    to: 'lead@example.com',
    subject: 'No send',
    body: 'No send'
  }), { code: 'MICROSOFT_GRAPH_SEND_FAILED' });
});


test('Microsoft Outlook provider adapter refreshes tokens and gates send on consent', async () => {
  const calls = [];
  const adapter = createMicrosoftGraphProviderAdapter({
    clientFactory: () => ({
      async refreshAccessToken({ refreshToken }) {
        calls.push(['refresh', refreshToken]);
        return { access_token: 'fresh-access-token-123456' };
      },
      async getProfile() {
        return { id: 'microsoft-user-001', userPrincipalName: 'owner@example.com' };
      },
      async sendMail(input) {
        calls.push(['send', input.to]);
        return { ok: true, provider: 'microsoft_graph', status: 'accepted' };
      }
    })
  });
  const verification = await adapter.verify({ secret: 'refresh-token-long-enough', config: {} });
  assert.equal(verification.verified, true);
  assert.equal(verification.accountId, 'microsoft-user-001');

  const denied = await adapter.dispatch({
    secret: 'refresh-token-long-enough',
    payload: { to: 'lead@example.com', subject: 'Follow up', body: 'Hello' },
    consent: { status: 'revoked' }
  });
  assert.equal(denied.code, 'CONSENT_REQUIRED');

  const sent = await adapter.dispatch({
    secret: 'refresh-token-long-enough',
    payload: { to: 'lead@example.com', subject: 'Follow up', body: 'Hello' },
    consent: { status: 'granted' }
  });
  assert.equal(sent.status, 'accepted');
  assert.equal(calls.filter(([kind]) => kind === 'send').length, 1);
});
