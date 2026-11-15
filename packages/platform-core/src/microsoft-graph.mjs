import { createHash, randomBytes } from 'node:crypto';

const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const DEFAULT_TENANT = 'common';
const DEFAULT_SCOPES = Object.freeze([
  'openid',
  'profile',
  'offline_access',
  'User.Read',
  'Mail.Read',
  'Mail.Send',
  'Calendars.ReadWrite'
]);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(label + ' is required');
  }
  return value.trim();
}

function tokenEndpoint(tenant = DEFAULT_TENANT) {
  const safeTenant = requiredString(tenant, 'Microsoft tenant');
  if (!/^[A-Za-z0-9.-]{2,120}$/.test(safeTenant)) {
    throw new TypeError('Microsoft tenant is invalid');
  }
  return `https://login.microsoftonline.com/${safeTenant}/oauth2/v2.0/token`;
}

function authorizationEndpoint(tenant = DEFAULT_TENANT) {
  const safeTenant = requiredString(tenant, 'Microsoft tenant');
  if (!/^[A-Za-z0-9.-]{2,120}$/.test(safeTenant)) {
    throw new TypeError('Microsoft tenant is invalid');
  }
  return `https://login.microsoftonline.com/${safeTenant}/oauth2/v2.0/authorize`;
}

function assertRedirectUri(redirectUri) {
  const url = new URL(requiredString(redirectUri, 'Microsoft redirect URI'));
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) {
    throw new TypeError('Microsoft redirect URI must use HTTPS except for localhost development');
  }
  if (url.username || url.password || url.hash) {
    throw new TypeError('Microsoft redirect URI must not contain credentials or a fragment');
  }
  return url.toString();
}

function normalizeTokenResponse(data, priorRefreshToken = null) {
  if (!data || typeof data !== 'object' || typeof data.access_token !== 'string' || !data.access_token) {
    const error = new Error('Microsoft identity platform returned an invalid token response');
    error.code = 'MICROSOFT_TOKEN_RESPONSE_INVALID';
    throw error;
  }

  const expiresIn = Number(data.expires_in);
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' && data.refresh_token
      ? data.refresh_token
      : priorRefreshToken,
    tokenType: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
    scope: typeof data.scope === 'string' ? data.scope : ''
  };
}

async function postTokenForm({ endpoint, form, fetchFn }) {
  if (typeof fetchFn !== 'function') throw new TypeError('A fetch implementation is required');
  let response;
  try {
    response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    const error = new Error('Microsoft identity platform could not be reached');
    error.code = 'MICROSOFT_IDENTITY_UNAVAILABLE';
    throw error;
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(
      typeof data.error_description === 'string'
        ? data.error_description.slice(0, 240)
        : `Microsoft identity platform returned HTTP ${response.status}`
    );
    error.status = response.status;
    error.code = typeof data.error === 'string' ? data.error : 'MICROSOFT_TOKEN_EXCHANGE_FAILED';
    throw error;
  }

  return data;
}

/**
 * Build a Microsoft identity platform authorization-code URL.
 * A fresh state value and S256 PKCE challenge must be generated and bound to
 * the initiating Operza session by the caller.
 */
export function buildMicrosoftAuthorizationUrl({
  clientId,
  redirectUri,
  state,
  codeChallenge,
  scopes = DEFAULT_SCOPES,
  tenant = DEFAULT_TENANT,
  prompt = 'select_account'
} = {}) {
  const params = new URLSearchParams({
    client_id: requiredString(clientId, 'Microsoft client ID'),
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: assertRedirectUri(redirectUri),
    scope: (Array.isArray(scopes) ? scopes : DEFAULT_SCOPES)
      .map(scope => requiredString(scope, 'OAuth scope'))
      .filter((scope, index, all) => all.indexOf(scope) === index)
      .join(' '),
    state: requiredString(state, 'OAuth state'),
    code_challenge: requiredString(codeChallenge, 'PKCE challenge'),
    code_challenge_method: 'S256'
  });

  if (prompt) params.set('prompt', prompt);
  return `${authorizationEndpoint(tenant)}?${params.toString()}`;
}

/**
 * Generate a PKCE verifier and its S256 challenge. The verifier is a secret
 * and must be stored server-side until the matching callback returns.
 */
export function createMicrosoftPkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export async function exchangeMicrosoftAuthorizationCode({
  clientId,
  clientSecret,
  redirectUri,
  code,
  codeVerifier,
  tenant = DEFAULT_TENANT,
  fetchFn = globalThis.fetch
} = {}) {
  const form = new URLSearchParams({
    client_id: requiredString(clientId, 'Microsoft client ID'),
    client_secret: requiredString(clientSecret, 'Microsoft client secret'),
    grant_type: 'authorization_code',
    code: requiredString(code, 'Microsoft authorization code'),
    redirect_uri: assertRedirectUri(redirectUri),
    code_verifier: requiredString(codeVerifier, 'PKCE verifier')
  });
  const data = await postTokenForm({ endpoint: tokenEndpoint(tenant), form, fetchFn });
  return normalizeTokenResponse(data);
}

export async function refreshMicrosoftAccessToken({
  clientId,
  clientSecret,
  refreshToken,
  tenant = DEFAULT_TENANT,
  scopes = DEFAULT_SCOPES,
  fetchFn = globalThis.fetch
} = {}) {
  const form = new URLSearchParams({
    client_id: requiredString(clientId, 'Microsoft client ID'),
    client_secret: requiredString(clientSecret, 'Microsoft client secret'),
    grant_type: 'refresh_token',
    refresh_token: requiredString(refreshToken, 'Microsoft refresh token'),
    scope: (Array.isArray(scopes) ? scopes : DEFAULT_SCOPES).join(' ')
  });
  const data = await postTokenForm({ endpoint: tokenEndpoint(tenant), form, fetchFn });
  return normalizeTokenResponse(data, refreshToken);
}

function validateGraphPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/v1.0/')) {
    throw new TypeError('A relative Microsoft Graph v1.0 path is required');
  }
  const parsed = new URL(path, GRAPH_ORIGIN);
  if (
    parsed.origin !== GRAPH_ORIGIN ||
    !parsed.pathname.startsWith('/v1.0/') ||
    parsed.username ||
    parsed.password
  ) {
    throw new TypeError('A relative Microsoft Graph v1.0 path is required');
  }
  return parsed.toString();
}

/**
 * Call Microsoft Graph using a path relative to /v1.0. Absolute URLs and
 * path traversal are rejected to prevent token exfiltration.
 */
export async function requestMicrosoftGraph({
  accessToken,
  path,
  method = 'GET',
  body,
  headers = {},
  fetchFn = globalThis.fetch
} = {}) {
  const token = requiredString(accessToken, 'Microsoft access token');
  const url = validateGraphPath(path);
  const httpMethod = String(method).toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(httpMethod)) {
    throw new TypeError('Unsupported Microsoft Graph HTTP method');
  }
  if (typeof fetchFn !== 'function') throw new TypeError('A fetch implementation is required');

  const requestHeaders = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    ...headers
  };
  const options = { method: httpMethod, headers: requestHeaders, signal: AbortSignal.timeout(20_000) };
  if (body !== undefined) {
    requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  let response;
  try {
    response = await fetchFn(url, options);
  } catch {
    const error = new Error('Microsoft Graph could not be reached');
    error.code = 'MICROSOFT_GRAPH_UNAVAILABLE';
    throw error;
  }

  let data = {};
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      data = {};
    }
  }

  if (!response.ok) {
    const graphError = data?.error || {};
    const error = new Error(
      typeof graphError.message === 'string'
        ? graphError.message.slice(0, 240)
        : `Microsoft Graph returned HTTP ${response.status}`
    );
    error.status = response.status;
    error.code = typeof graphError.code === 'string' ? graphError.code : 'MICROSOFT_GRAPH_REQUEST_FAILED';
    throw error;
  }

  const result = data && typeof data === 'object' ? data : { value: data };
  Object.defineProperty(result, 'statusCode', { value: response.status, enumerable: false });
  return result;
}

export function getMicrosoftProfile({ accessToken, fetchFn } = {}) {
  return requestMicrosoftGraph({
    accessToken,
    path: '/v1.0/me?$select=id,displayName,givenName,surname,mail,userPrincipalName',
    fetchFn
  });
}

export async function listOutlookMessages({ accessToken, top = 25, fetchFn } = {}) {
  const pageSize = Number(top);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new RangeError('Outlook message page size must be between 1 and 100');
  }
  const params = new URLSearchParams({
    '$top': String(pageSize),
    '$select': 'id,subject,from,receivedDateTime,isRead,bodyPreview,conversationId',
    '$orderby': 'receivedDateTime desc'
  });
  const result = await requestMicrosoftGraph({
    accessToken,
    path: `/v1.0/me/messages?${params.toString()}`,
    fetchFn
  });
  return {
    value: Array.isArray(result.value) ? result.value : [],
    nextLink: typeof result['@odata.nextLink'] === 'string' ? result['@odata.nextLink'] : null
  };
}

export async function sendOutlookMail({
  accessToken,
  to,
  subject,
  body,
  contentType = 'Text',
  saveToSentItems = true,
  fetchFn
} = {}) {
  const recipients = (Array.isArray(to) ? to : [to])
    .map(address => requiredString(address, 'Email recipient'))
    .map(address => ({ emailAddress: { address } }));
  if (!recipients.length) throw new TypeError('At least one email recipient is required');
  const bodyText = requiredString(body, 'Email body');
  const normalizedType = String(contentType).toLowerCase() === 'html' ? 'HTML' : 'Text';

  const result = await requestMicrosoftGraph({
    accessToken,
    method: 'POST',
    path: '/v1.0/me/sendMail',
    body: {
      message: {
        subject: requiredString(subject, 'Email subject'),
        body: { contentType: normalizedType, content: bodyText },
        toRecipients: recipients
      },
      saveToSentItems: Boolean(saveToSentItems)
    },
    fetchFn
  });
  return { accepted: result.statusCode === 202, statusCode: result.statusCode };
}

export function createOutlookCalendarEvent({
  accessToken,
  subject,
  start,
  end,
  body,
  attendees = [],
  location,
  fetchFn
} = {}) {
  requiredString(start?.dateTime, 'Event start dateTime');
  requiredString(start?.timeZone, 'Event start timeZone');
  requiredString(end?.dateTime, 'Event end dateTime');
  requiredString(end?.timeZone, 'Event end timeZone');
  const event = {
    subject: requiredString(subject, 'Event subject'),
    start,
    end
  };
  if (body) event.body = body;
  if (location) event.location = location;
  if (Array.isArray(attendees) && attendees.length) {
    event.attendees = attendees.map(attendee => ({
      emailAddress: { address: requiredString(attendee.email, 'Attendee email') },
      type: attendee.type || 'required'
    }));
  }
  return requestMicrosoftGraph({
    accessToken,
    method: 'POST',
    path: '/v1.0/me/events',
    body: event,
    fetchFn
  });
}
