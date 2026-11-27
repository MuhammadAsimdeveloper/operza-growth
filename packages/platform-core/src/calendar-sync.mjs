import { createHash, createHmac, timingSafeEqual, randomUUID, randomBytes } from 'node:crypto';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

const MS_AUTHORITY = 'https://login.microsoftonline.com';
const MS_GRAPH_API = 'https://graph.microsoft.com/v1.0';

export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly'
];

export const MS_CALENDAR_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'Calendars.ReadWrite'
];

function sha256(val) {
  return createHash('sha256').update(String(val)).digest('hex');
}

/**
 * Generates cryptographically secure PKCE code verifier and challenge (RFC 7636).
 */
export function generatePKCE() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}

export function signOAuthState(payload, secretKey) {
  const serialized = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secretKey).update(serialized).digest('hex');
  return `${serialized}.${signature}`;
}

export function verifyOAuthState(stateString, secretKey, maxAgeMs = 600_000) {
  if (typeof stateString !== 'string' || !stateString.includes('.')) {
    throw Object.assign(new Error('Invalid OAuth state format'), { code: 'OAUTH_STATE_INVALID' });
  }
  const [dataPart, sigPart] = stateString.split('.');
  const expectedSig = createHmac('sha256', secretKey).update(dataPart).digest('hex');
  const a = Buffer.from(sigPart, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw Object.assign(new Error('OAuth state signature mismatch'), { code: 'OAUTH_STATE_INVALID' });
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(dataPart, 'base64url').toString('utf8'));
  } catch {
    throw Object.assign(new Error('Malformed OAuth state data'), { code: 'OAUTH_STATE_INVALID' });
  }
  if (!payload.createdAt || (Date.now() - payload.createdAt > maxAgeMs)) {
    throw Object.assign(new Error('OAuth state expired'), { code: 'OAUTH_STATE_EXPIRED' });
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Google Calendar Provider Adapter
// ---------------------------------------------------------------------------

export const googleCalendarAdapter = {
  providerKey: 'calendar.google',
  name: 'Google Calendar',

  getAuthorizationUrl({ clientId, redirectUri, stateKey, tenantId, locationId, calendarId, codeChallenge, state: customState }) {
    if (!clientId) throw Object.assign(new Error('Google Client ID is not configured'), { code: 'GOOGLE_CONFIG_MISSING' });
    const state = customState || signOAuthState({
      tenantId,
      locationId,
      calendarId,
      provider: 'google_calendar',
      createdAt: Date.now()
    }, stateKey);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_CALENDAR_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state
    });
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }
    return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
  },

  async exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier, fetchFn = globalThis.fetch }) {
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });
    if (codeVerifier) {
      params.set('code_verifier', codeVerifier);
    }

    const res = await fetchFn(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw Object.assign(new Error(`Google token exchange failed: ${data.error_description || res.statusText}`), {
        code: 'GOOGLE_TOKEN_EXCHANGE_FAILED',
        httpStatus: res.status
      });
    }

    // Verify token identity
    const userRes = await fetchFn('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${data.access_token}` }
    });
    const userInfo = await userRes.json().catch(() => ({}));

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      email: userInfo.email || null,
      accountId: userInfo.id || null
    };
  },

  async refreshToken({ refreshToken, clientId, clientSecret, fetchFn = globalThis.fetch }) {
    if (!refreshToken) throw Object.assign(new Error('Refresh token is required'), { code: 'GOOGLE_REFRESH_TOKEN_MISSING' });
    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token'
    });

    const res = await fetchFn(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw Object.assign(new Error('Google token refresh rejected'), {
        code: 'GOOGLE_AUTH_FAILED',
        httpStatus: res.status
      });
    }

    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
    };
  },

  async verify({ accessToken, refreshToken, clientId, clientSecret, fetchFn = globalThis.fetch }) {
    if (!accessToken && !refreshToken) {
      return { verified: false, code: 'CREDENTIAL_REQUIRED' };
    }
    let token = accessToken;
    let res = await fetchFn(`${GOOGLE_CALENDAR_API}/users/me/calendarList/primary`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 401 && refreshToken && clientId && clientSecret) {
      try {
        const refreshed = await this.refreshToken({ refreshToken, clientId, clientSecret, fetchFn });
        token = refreshed.accessToken;
        res = await fetchFn(`${GOOGLE_CALENDAR_API}/users/me/calendarList/primary`, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch {
        return { verified: false, code: 'CALENDAR_AUTH_FAILED', httpStatus: 401 };
      }
    }

    if (!res.ok) {
      return { verified: false, code: 'CALENDAR_AUTH_FAILED', httpStatus: res.status };
    }

    const data = await res.json().catch(() => ({}));
    return {
      verified: true,
      email: data.id || null,
      calendarName: data.summary || 'Google Primary Calendar',
      freshAccessToken: token
    };
  },

  async listCalendars({ accessToken, refreshToken, clientId, clientSecret, fetchFn = globalThis.fetch }) {
    let token = accessToken;
    if (!token && refreshToken && clientId && clientSecret) {
      const refreshed = await this.refreshToken({ refreshToken, clientId, clientSecret, fetchFn });
      token = refreshed.accessToken;
    }
    if (!token) throw Object.assign(new Error('Access token is required to list Google calendars'), { code: 'CALENDAR_AUTH_FAILED' });
    let res = await fetchFn(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 401 && refreshToken && clientId && clientSecret) {
      const refreshed = await this.refreshToken({ refreshToken, clientId, clientSecret, fetchFn });
      token = refreshed.accessToken;
      res = await fetchFn(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    }
    if (!res.ok) throw Object.assign(new Error(`Failed to list Google calendars (${res.status})`), { code: 'CALENDAR_FETCH_FAILED', httpStatus: res.status });
    const data = await res.json().catch(() => ({}));
    return (data.items || []).map(item => ({
      id: item.id,
      name: item.summary || item.id,
      primary: Boolean(item.primary),
      isPrimary: Boolean(item.primary),
      timeZone: item.timeZone || null
    }));
  },

  async fetchEvents({ accessToken, timeMin, timeMax, fetchFn = globalThis.fetch }) {
    const url = new URL(`${GOOGLE_CALENDAR_API}/calendars/primary/events`);
    if (timeMin) url.searchParams.set('timeMin', new Date(timeMin).toISOString());
    if (timeMax) url.searchParams.set('timeMax', new Date(timeMax).toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');

    const res = await fetchFn(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      throw Object.assign(new Error(`Failed to retrieve Google Calendar events (${res.status})`), {
        code: res.status === 401 ? 'CALENDAR_UNAUTHORIZED' : 'CALENDAR_FETCH_FAILED',
        httpStatus: res.status
      });
    }

    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    return items
      .filter(item => item.status !== 'cancelled')
      .map(item => ({
        id: item.id,
        externalId: item.id,
        title: item.summary || 'Busy',
        startsAt: item.start?.dateTime || item.start?.date,
        endsAt: item.end?.dateTime || item.end?.date,
        status: 'busy',
        source: 'google_calendar'
      }));
  },

  async createEvent({ accessToken, event, fetchFn = globalThis.fetch }) {
    const body = {
      summary: event.title || 'Operza Appointment',
      description: event.notes || '',
      start: { dateTime: new Date(event.startsAt).toISOString() },
      end: { dateTime: new Date(event.endsAt).toISOString() }
    };

    const res = await fetchFn(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw Object.assign(new Error(`Google event creation failed (${res.status})`), {
        code: 'GOOGLE_EVENT_CREATE_FAILED',
        httpStatus: res.status
      });
    }

    const data = await res.json();
    return {
      externalId: data.id,
      htmlLink: data.htmlLink,
      status: 'confirmed'
    };
  }
};

// ---------------------------------------------------------------------------
// Microsoft Graph Calendar Provider Adapter
// ---------------------------------------------------------------------------

export const microsoftGraphCalendarAdapter = {
  providerKey: 'calendar.microsoft_graph',
  name: 'Microsoft Outlook 365 Calendar',

  getAuthorizationUrl({ clientId, redirectUri, stateKey, tenantId, locationId, calendarId, tenant = 'common', codeChallenge, state: customState }) {
    if (!clientId) throw Object.assign(new Error('Microsoft Client ID is not configured'), { code: 'MICROSOFT_CONFIG_MISSING' });
    const state = customState || signOAuthState({
      tenantId,
      locationId,
      calendarId,
      provider: 'microsoft_graph',
      createdAt: Date.now()
    }, stateKey);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: MS_CALENDAR_SCOPES.join(' '),
      response_mode: 'query',
      state
    });
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }
    return `${MS_AUTHORITY}/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${params.toString()}`;
  },

  async exchangeCode({ code, clientId, clientSecret, redirectUri, tenant = 'common', codeVerifier, fetchFn = globalThis.fetch }) {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: MS_CALENDAR_SCOPES.join(' ')
    });
    if (codeVerifier) {
      params.set('code_verifier', codeVerifier);
    }

    const res = await fetchFn(`${MS_AUTHORITY}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw Object.assign(new Error(`Microsoft token exchange failed: ${data.error_description || res.statusText}`), {
        code: 'OUTLOOK_TOKEN_EXCHANGE_FAILED',
        httpStatus: res.status
      });
    }

    // Verify user profile
    const userRes = await fetchFn(`${MS_GRAPH_API}/me`, {
      headers: { Authorization: `Bearer ${data.access_token}` }
    });
    const profile = await userRes.json().catch(() => ({}));

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      email: profile.mail || profile.userPrincipalName || null,
      accountId: profile.id || null
    };
  },

  async refreshToken({ refreshToken, clientId, clientSecret, tenant = 'common', fetchFn = globalThis.fetch }) {
    if (!refreshToken) throw Object.assign(new Error('Refresh token missing'), { code: 'MICROSOFT_REFRESH_TOKEN_MISSING' });
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: MS_CALENDAR_SCOPES.join(' ')
    });

    const res = await fetchFn(`${MS_AUTHORITY}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw Object.assign(new Error('Microsoft token refresh rejected'), {
        code: 'CALENDAR_AUTH_FAILED',
        httpStatus: res.status
      });
    }

    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
    };
  },

  async verify({ accessToken, refreshToken, clientId, clientSecret, fetchFn = globalThis.fetch }) {
    if (!accessToken && !refreshToken) {
      return { verified: false, code: 'CREDENTIAL_REQUIRED' };
    }
    let token = accessToken;
    let res = await fetchFn(`${MS_GRAPH_API}/me/calendar`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 401 && refreshToken && clientId && clientSecret) {
      try {
        const refreshed = await this.refreshToken({ refreshToken, clientId, clientSecret, fetchFn });
        token = refreshed.accessToken;
        res = await fetchFn(`${MS_GRAPH_API}/me/calendar`, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch {
        return { verified: false, code: 'CALENDAR_AUTH_FAILED', httpStatus: 401 };
      }
    }

    if (!res.ok) {
      return { verified: false, code: 'CALENDAR_AUTH_FAILED', httpStatus: res.status };
    }

    const data = await res.json().catch(() => ({}));
    return {
      verified: true,
      calendarName: data.name || 'Outlook Calendar',
      owner: data.owner?.name || data.owner?.address || null,
      freshAccessToken: token
    };
  },

  async listCalendars({ accessToken, refreshToken, clientId, clientSecret, fetchFn = globalThis.fetch }) {
    let token = accessToken;
    if (!token && refreshToken && clientId && clientSecret) {
      const refreshed = await this.refreshToken({ refreshToken, clientId, clientSecret, fetchFn });
      token = refreshed.accessToken;
    }
    if (!token) throw Object.assign(new Error('Access token is required to list Microsoft calendars'), { code: 'CALENDAR_AUTH_FAILED' });
    let res = await fetchFn(`${MS_GRAPH_API}/me/calendars`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 401 && refreshToken && clientId && clientSecret) {
      const refreshed = await this.refreshToken({ refreshToken, clientId, clientSecret, fetchFn });
      token = refreshed.accessToken;
      res = await fetchFn(`${MS_GRAPH_API}/me/calendars`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    }
    if (!res.ok) throw Object.assign(new Error(`Failed to list Microsoft calendars (${res.status})`), { code: 'CALENDAR_FETCH_FAILED', httpStatus: res.status });
    const data = await res.json().catch(() => ({}));
    return (data.value || []).map(item => ({
      id: item.id,
      name: item.name || item.id,
      isDefault: Boolean(item.isDefaultCalendar),
      isPrimary: Boolean(item.isDefaultCalendar),
      canEdit: Boolean(item.canEdit)
    }));
  },

  async fetchEvents({ accessToken, timeMin, timeMax, fetchFn = globalThis.fetch }) {
    const url = new URL(`${MS_GRAPH_API}/me/calendarView`);
    url.searchParams.set('startDateTime', new Date(timeMin || Date.now()).toISOString());
    url.searchParams.set('endDateTime', new Date(timeMax || (Date.now() + 30 * 86400000)).toISOString());

    const res = await fetchFn(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      throw Object.assign(new Error(`Microsoft Graph calendarView request failed (${res.status})`), {
        code: res.status === 401 ? 'CALENDAR_UNAUTHORIZED' : 'CALENDAR_FETCH_FAILED',
        httpStatus: res.status
      });
    }

    const data = await res.json();
    const items = Array.isArray(data.value) ? data.value : [];

    return items
      .filter(item => !item.isCancelled)
      .map(item => ({
        id: item.id,
        externalId: item.id,
        title: item.subject || 'Busy',
        startsAt: item.start?.dateTime ? `${item.start.dateTime}Z` : item.start?.dateTime,
        endsAt: item.end?.dateTime ? `${item.end.dateTime}Z` : item.end?.dateTime,
        status: 'busy',
        source: 'microsoft_graph'
      }));
  },

  async createEvent({ accessToken, event, fetchFn = globalThis.fetch }) {
    const body = {
      subject: event.title || 'Operza Appointment',
      body: {
        contentType: 'text',
        content: event.notes || ''
      },
      start: {
        dateTime: new Date(event.startsAt).toISOString().replace('Z', ''),
        timeZone: 'UTC'
      },
      end: {
        dateTime: new Date(event.endsAt).toISOString().replace('Z', ''),
        timeZone: 'UTC'
      }
    };

    const res = await fetchFn(`${MS_GRAPH_API}/me/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw Object.assign(new Error(`Microsoft Graph event creation failed (${res.status})`), {
        code: 'OUTLOOK_EVENT_CREATE_FAILED',
        httpStatus: res.status
      });
    }

    const data = await res.json();
    return {
      externalId: data.id,
      webLink: data.webLink,
      status: 'confirmed'
    };
  }
};

// ---------------------------------------------------------------------------
// Unified Calendar Synchronization Engine
// ---------------------------------------------------------------------------

export async function executeCalendarSync({
  calendar = {},
  appointments = [],
  syncDirection = 'two_way',
  credentials = {},
  timeMin = new Date().toISOString(),
  timeMax = new Date(Date.now() + 30 * 86400000).toISOString(),
  fetchFn = globalThis.fetch
}) {
  const providerKey = calendar?.externalSync?.provider || credentials?.provider;
  let adapter = null;

  if (providerKey === 'google_calendar' || providerKey === 'google') {
    adapter = googleCalendarAdapter;
  } else if (providerKey === 'microsoft_graph' || providerKey === 'outlook' || providerKey === 'office365') {
    adapter = microsoftGraphCalendarAdapter;
  } else {
    throw Object.assign(new Error(`Unsupported calendar sync provider: ${providerKey}`), {
      code: 'UNSUPPORTED_CALENDAR_PROVIDER'
    });
  }

  const token = credentials.accessToken || calendar.externalSync?.accessToken;
  const refreshToken = credentials.refreshToken || calendar.externalSync?.refreshToken;

  if (!token && !refreshToken) {
    throw Object.assign(new Error('Calendar sync requires valid credentials or tokens'), {
      code: 'CALENDAR_AUTH_FAILED'
    });
  }

  // 1. Verify provider access
  let verification;
  try {
    verification = await adapter.verify({
      accessToken: token,
      refreshToken,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      fetchFn
    });
  } catch (err) {
    throw Object.assign(new Error(`Provider verification failed: ${err?.message || 'Verification error'}`), {
      code: err?.code || 'CALENDAR_AUTH_FAILED'
    });
  }

  if (!verification?.verified) {
    throw Object.assign(new Error(`Provider verification failed: ${verification?.code || 'CALENDAR_AUTH_FAILED'}`), {
      code: verification?.code || 'CALENDAR_AUTH_FAILED'
    });
  }

  const activeToken = verification.freshAccessToken || token;
  let importedBusyBlocks = [];
  let exportedEvents = [];

  // 2. Import External Events (if syncDirection is 'import' or 'two_way')
  if (syncDirection === 'import' || syncDirection === 'two_way') {
    const externalEvents = await adapter.fetchEvents({
      accessToken: activeToken,
      timeMin,
      timeMax,
      fetchFn
    });

    const newlyImported = externalEvents.map(e => ({
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      title: e.title,
      externalId: e.externalId,
      provider: providerKey
    }));

    // Deduplicate against existing calendar busy blocks so repeated sync does not duplicate
    const blockMap = new Map();
    for (const b of (calendar.externalBusyBlocks || [])) {
      const key = b.externalId || `${b.startsAt}_${b.endsAt}`;
      blockMap.set(key, b);
    }
    for (const b of newlyImported) {
      const key = b.externalId || `${b.startsAt}_${b.endsAt}`;
      blockMap.set(key, b);
    }
    importedBusyBlocks = Array.from(blockMap.values());
  }

  // 3. Export Local Appointments (if syncDirection is 'export' or 'two_way')
  if (syncDirection === 'export' || syncDirection === 'two_way') {
    const unexported = (appointments || []).filter(a =>
      a.calendarId === calendar.id &&
      a.status !== 'cancelled' &&
      !a.externalEventId &&
      new Date(a.startsAt) >= new Date(timeMin) &&
      new Date(a.endsAt) <= new Date(timeMax)
    );

    for (const appt of unexported) {
      try {
        const created = await adapter.createEvent({
          accessToken: activeToken,
          event: appt,
          fetchFn
        });
        appt.externalEventId = created.externalId;
        exportedEvents.push({
          appointmentId: appt.id,
          externalId: created.externalId
        });
      } catch (err) {
        throw Object.assign(new Error(`Failed to export appointment ${appt.id} to external calendar: ${err.message}`), {
          code: 'CALENDAR_EXPORT_FAILED'
        });
      }
    }
  }

  return {
    success: true,
    provider: providerKey,
    syncDirection,
    busyBlocks: importedBusyBlocks,
    busyBlocksCount: importedBusyBlocks.length,
    exportedEvents,
    exportedCount: exportedEvents.length,
    lastSyncAt: new Date().toISOString()
  };
}
