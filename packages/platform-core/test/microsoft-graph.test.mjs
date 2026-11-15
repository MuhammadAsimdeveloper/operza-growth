import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMicrosoftAuthorizationUrl,
  exchangeMicrosoftAuthorizationCode,
  refreshMicrosoftAccessToken,
  requestMicrosoftGraph,
  getMicrosoftProfile,
  listOutlookMessages,
  sendOutlookMail,
  createOutlookCalendarEvent
} from '../src/microsoft-graph.mjs';

const credentials = {
  clientId: 'operza-client-id',
  clientSecret: 'operza-client-secret',
  redirectUri: 'https://app.operza.test/api/platform/microsoft/oauth/callback',
  tenant: 'common'
};

test('Microsoft authorization URL binds tenant, redirect URI, state and PKCE challenge', () => {
  const url = new URL(buildMicrosoftAuthorizationUrl({
    ...credentials,
    state: 'state-bound-to-session',
    codeChallenge: 'pkce-challenge',
    scopes: ['openid', 'profile', 'offline_access', 'User.Read', 'Mail.Read']
  }));

  assert.equal(url.origin, 'https://login.microsoftonline.com');
  assert.equal(url.pathname, '/common/oauth2/v2.0/authorize');
  assert.equal(url.searchParams.get('client_id'), credentials.clientId);
  assert.equal(url.searchParams.get('redirect_uri'), credentials.redirectUri);
  assert.equal(url.searchParams.get('state'), 'state-bound-to-session');
  assert.equal(url.searchParams.get('code_challenge'), 'pkce-challenge');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('scope'), /offline_access/);
  assert.match(url.searchParams.get('scope'), /Mail.Read/);
});

test('authorization-code exchange uses PKCE and returns token data without logging secrets', async () => {
  let request;
  const fetchFn = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        token_type: 'Bearer',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: 'User.Read Mail.Read'
      })
    };
  };

  const tokens = await exchangeMicrosoftAuthorizationCode({
    ...credentials,
    code: 'authorization-code',
    codeVerifier: 'original-pkce-verifier',
    fetchFn
  });

  assert.equal(request.url, 'https://login.microsoftonline.com/common/oauth2/v2.0/token');
  assert.match(request.options.headers['Content-Type'], /application\/x-www-form-urlencoded/);
  const form = new URLSearchParams(request.options.body);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code'), 'authorization-code');
  assert.equal(form.get('code_verifier'), 'original-pkce-verifier');
  assert.equal(form.get('client_secret'), credentials.clientSecret);
  assert.equal(tokens.accessToken, 'access-token');
  assert.equal(tokens.refreshToken, 'refresh-token');
  assert.equal(tokens.expiresIn, 3600);
});

test('refresh-token exchange preserves the replacement refresh token', async () => {
  let form;
  const tokens = await refreshMicrosoftAccessToken({
    ...credentials,
    refreshToken: 'old-refresh-token',
    fetchFn: async (_url, options) => {
      form = new URLSearchParams(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'rotated-refresh-token',
          expires_in: 3599
        })
      };
    }
  });

  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('refresh_token'), 'old-refresh-token');
  assert.equal(tokens.accessToken, 'new-access-token');
  assert.equal(tokens.refreshToken, 'rotated-refresh-token');
});

test('Graph request only permits relative v1.0 paths and attaches bearer authorization', async () => {
  let request;
  const payload = await requestMicrosoftGraph({
    accessToken: 'graph-access-token',
    path: '/v1.0/me',
    fetchFn: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ id: 'user-1', mail: 'owner@example.test' }) };
    }
  });

  assert.equal(request.url, 'https://graph.microsoft.com/v1.0/me');
  assert.equal(request.options.headers.Authorization, 'Bearer graph-access-token');
  assert.equal(payload.id, 'user-1');

  await assert.rejects(
    () => requestMicrosoftGraph({ accessToken: 'x', path: 'https://attacker.test/steal' }),
    /relative Microsoft Graph v1.0 path/
  );
  await assert.rejects(
    () => requestMicrosoftGraph({ accessToken: 'x', path: '/v1.0/../token' }),
    /relative Microsoft Graph v1.0 path/
  );
});

test('profile and message listing use the authenticated mailbox and preserve Graph paging', async () => {
  const requested = [];
  const fetchFn = async (url) => {
    requested.push(url);
    if (url.endsWith('/v1.0/me')) {
      return { ok: true, status: 200, json: async () => ({ id: 'user-1', displayName: 'Asim', mail: 'asim@example.test' }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        value: [{ id: 'message-1', subject: 'Hello' }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skip=25'
      })
    };
  };

  const profile = await getMicrosoftProfile({ accessToken: 'access-token', fetchFn });
  const messages = await listOutlookMessages({ accessToken: 'access-token', top: 25, fetchFn });

  assert.equal(profile.mail, 'asim@example.test');
  assert.equal(messages.value[0].id, 'message-1');
  assert.equal(messages.nextLink, 'https://graph.microsoft.com/v1.0/me/messages?$skip=25');
  assert.ok(requested.some(url => url.endsWith('/v1.0/me/messages?$top=25')));
});

test('sendOutlookMail calls Graph sendMail and returns the provider acceptance status', async () => {
  let request;
  const result = await sendOutlookMail({
    accessToken: 'access-token',
    to: ['customer@example.test'],
    subject: 'Welcome',
    body: 'Hello from Operza',
    fetchFn: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 202, json: async () => ({}) };
    }
  });

  const payload = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://graph.microsoft.com/v1.0/me/sendMail');
  assert.equal(payload.message.subject, 'Welcome');
  assert.equal(payload.message.toRecipients[0].emailAddress.address, 'customer@example.test');
  assert.equal(result.accepted, true);
  assert.equal(result.statusCode, 202);
});

test('calendar event creation uses Graph events endpoint and preserves timezone fields', async () => {
  let request;
  const result = await createOutlookCalendarEvent({
    accessToken: 'access-token',
    subject: 'Discovery call',
    start: { dateTime: '2026-11-20T10:00:00', timeZone: 'Asia/Karachi' },
    end: { dateTime: '2026-11-20T10:30:00', timeZone: 'Asia/Karachi' },
    fetchFn: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201, json: async () => ({ id: 'event-1', subject: 'Discovery call' }) };
    }
  });

  assert.equal(request.url, 'https://graph.microsoft.com/v1.0/me/events');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.start.timeZone, 'Asia/Karachi');
  assert.equal(payload.end.timeZone, 'Asia/Karachi');
  assert.equal(result.id, 'event-1');
});

test('Graph errors return structured status without echoing the access token', async () => {
  await assert.rejects(
    () => requestMicrosoftGraph({
      accessToken: 'do-not-echo-this-token',
      path: '/v1.0/me',
      fetchFn: async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: { code: 'ErrorAccessDenied', message: 'Access denied' } })
      })
    }),
    error => error.status === 403 && error.code === 'ErrorAccessDenied' && !error.message.includes('do-not-echo-this-token')
  );
});
