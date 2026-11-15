import { createHash, randomBytes } from 'node:crypto';

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const DEFAULT_SCOPES = Object.freeze([
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Mail.Send'
]);

function requiredString(value, name, maxLength = 2048) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw Object.assign(new TypeError(`${name} is required`), { code: 'MICROSOFT_INVALID_INPUT' });
  }
  return value.trim();
}

function assertTenant(tenantId) {
  const value = requiredString(tenantId || 'common', 'tenantId', 120);
  if (!/^(common|organizations|consumers|[A-Za-z0-9.-]+)$/.test(value)) {
    throw Object.assign(new TypeError('Invalid Microsoft tenant identifier'), { code: 'MICROSOFT_INVALID_TENANT' });
  }
  return value;
}

function parseEmailList(to) {
  const entries = Array.isArray(to) ? to : [to];
  if (entries.length < 1 || entries.length > 100) {
    throw Object.assign(new TypeError('At least one and at most 100 recipients are required'), { code: 'MICROSOFT_INVALID_RECIPIENTS' });
  }
  return entries.map(value => {
    const address = requiredString(value, 'recipient', 320).toLowerCase();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
      throw Object.assign(new TypeError('A recipient email address is invalid'), { code: 'MICROSOFT_INVALID_RECIPIENTS' });
    }
    return { emailAddress: { address } };
  });
}

async function responseJson(response, code) {
  if (!response?.ok) {
    let providerCode = code;
    let detail = '';
    try {
      const payload = await response.json();
      providerCode = payload?.error?.code || code;
      detail = payload?.error?.message || '';
    } catch {
      detail = await response?.text?.().catch(() => '') || '';
    }
    throw Object.assign(new Error(detail.slice(0, 240) || 'Microsoft request was rejected'), {
      code,
      providerCode,
      status: response?.status || 0
    });
  }
  return response.status === 204 ? null : response.json();
}

/** Generate a PKCE verifier and the S256 challenge required by the OAuth flow. */
export function createMicrosoftPkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}

/**
 * Server-side Microsoft identity platform + Microsoft Graph client.
 * Tokens must be stored in a persistent encrypted vault by the caller.
 */
export function createMicrosoftGraphClient({
  clientId = process.env.MICROSOFT_CLIENT_ID,
  clientSecret = process.env.MICROSOFT_CLIENT_SECRET,
  tenantId = process.env.MICROSOFT_TENANT_ID || 'common',
  redirectUri = process.env.MICROSOFT_REDIRECT_URI,
  fetchFn = globalThis.fetch,
  timeoutMs = 10_000
} = {}) {
  const appId = requiredString(clientId, 'MICROSOFT_CLIENT_ID', 200);
  const callback = requiredString(redirectUri, 'MICROSOFT_REDIRECT_URI', 2048);
  const tenant = assertTenant(tenantId);
  const tokenEndpoint = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  if (typeof fetchFn !== 'function') {
    throw Object.assign(new TypeError('A fetch implementation is required'), { code: 'MICROSOFT_FETCH_UNAVAILABLE' });
  }

  async function request(url, options) {
    return fetchFn(url, {
      ...options,
      signal: options.signal || AbortSignal.timeout(Math.max(1_000, Math.min(30_000, timeoutMs)))
    });
  }

  async function tokenRequest(fields) {
    const form = new URLSearchParams({
      client_id: appId,
      ...fields
    });
    if (fields.grant_type === 'authorization_code') form.set('redirect_uri', callback);
    if (clientSecret) form.set('client_secret', clientSecret);

    const response = await request(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString()
    });
    return responseJson(response, 'MICROSOFT_TOKEN_REQUEST_FAILED');
  }

  async function graphRequest(path, accessToken, options = {}) {
    const token = requiredString(accessToken, 'accessToken', 16_384);
    const response = await request(`${GRAPH_ROOT}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    return response;
  }

  return Object.freeze({
    buildAuthorizationUrl({ state, codeChallenge, scopes = DEFAULT_SCOPES } = {}) {
      const oauthState = requiredString(state, 'OAuth state', 512);
      const challenge = requiredString(codeChallenge, 'PKCE code challenge', 256);
      if (!Array.isArray(scopes) || scopes.some(scope => typeof scope !== 'string' || !/^[A-Za-z._-]+$/.test(scope))) {
        throw Object.assign(new TypeError('OAuth scopes must be a list of valid scope names'), { code: 'MICROSOFT_INVALID_SCOPES' });
      }
      const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
      url.search = new URLSearchParams({
        client_id: appId,
        response_type: 'code',
        response_mode: 'query',
        redirect_uri: callback,
        scope: scopes.join(' '),
        state: oauthState,
        code_challenge: challenge,
        code_challenge_method: 'S256'
      }).toString();
      return url.toString();
    },

    async exchangeCode({ code, codeVerifier } = {}) {
      return tokenRequest({
        grant_type: 'authorization_code',
        code: requiredString(code, 'authorization code', 4096),
        code_verifier: requiredString(codeVerifier, 'PKCE code verifier', 256),
        scope: DEFAULT_SCOPES.join(' ')
      });
    },

    async refreshAccessToken({ refreshToken } = {}) {
      return tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: requiredString(refreshToken, 'refresh token', 16_384),
        scope: DEFAULT_SCOPES.join(' ')
      });
    },

    async getProfile({ accessToken } = {}) {
      const response = await graphRequest('/me?$select=id,displayName,mail,userPrincipalName', accessToken);
      return responseJson(response, 'MICROSOFT_PROFILE_REQUEST_FAILED');
    },

    async sendMail({ accessToken, to, subject, body, bodyType = 'Text', saveToSentItems = true } = {}) {
      const normalizedSubject = requiredString(subject, 'subject', 998);
      const normalizedBody = requiredString(body, 'body', 100_000);
      if (!['Text', 'HTML'].includes(bodyType)) {
        throw Object.assign(new TypeError('bodyType must be Text or HTML'), { code: 'MICROSOFT_INVALID_BODY_TYPE' });
      }

      const payload = {
        message: {
          subject: normalizedSubject,
          body: { contentType: bodyType, content: normalizedBody },
          toRecipients: parseEmailList(to)
        },
        saveToSentItems: Boolean(saveToSentItems)
      };
      const response = await graphRequest('/me/sendMail', accessToken, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (response.status !== 202) {
        throw Object.assign(new Error('Microsoft Graph did not accept the sendMail request'), {
          code: 'MICROSOFT_GRAPH_SEND_FAILED',
          status: response.status || 0
        });
      }

      return {
        ok: true,
        provider: 'microsoft_graph',
        status: 'accepted',
        requestId: response.headers?.get?.('request-id') || null,
        acceptedAt: new Date().toISOString()
      };
    }
  });
}


/**
 * Provider-lifecycle adapter. The vault secret is an OAuth refresh token;
 * each send obtains a short-lived access token and returns Graph's 202
 * acceptance status (never a fabricated delivery receipt).
 */
export function createMicrosoftGraphProviderAdapter({ clientFactory = createMicrosoftGraphClient } = {}) {
  return Object.freeze({
    id: 'adapter-microsoft-graph-mail-v1',
    providerKey: 'email.microsoft_graph',
    channel: 'email',

    async verify({ secret, config = {} } = {}) {
      if (typeof secret !== 'string' || secret.length < 16) {
        return { verified: false, error: 'Microsoft OAuth refresh token is missing or malformed' };
      }
      const client = clientFactory({ tenantId: config.tenantId || 'common' });
      const tokens = await client.refreshAccessToken({ refreshToken: secret });
      if (typeof tokens?.access_token !== 'string' || tokens.access_token.length < 16) {
        return { verified: false, error: 'Microsoft did not issue an access token' };
      }
      const profile = await client.getProfile({ accessToken: tokens.access_token });
      const accountId = profile?.id || profile?.userPrincipalName || profile?.mail;
      if (typeof accountId !== 'string' || !accountId) {
        return { verified: false, error: 'Microsoft Graph returned no account identity' };
      }
      return { verified: true, accountId: accountId.slice(0, 120) };
    },

    async dispatch({ secret, config = {}, payload = {}, consent } = {}) {
      if (!consent || consent.status !== 'granted') {
        return { ok: false, error: 'Communication consent not granted', code: 'CONSENT_REQUIRED' };
      }
      const client = clientFactory({ tenantId: config.tenantId || 'common' });
      const tokens = await client.refreshAccessToken({ refreshToken: secret });
      if (typeof tokens?.access_token !== 'string' || tokens.access_token.length < 16) {
        return { ok: false, error: 'Microsoft token refresh did not return an access token', code: 'MICROSOFT_TOKEN_REFRESH_FAILED' };
      }
      return client.sendMail({
        accessToken: tokens.access_token,
        to: payload.to || payload.recipient,
        subject: payload.subject,
        body: payload.body || payload.message,
        bodyType: payload.bodyType || 'Text'
      });
    }
  });
}
