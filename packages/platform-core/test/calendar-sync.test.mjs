import test from 'node:test';
import assert from 'node:assert/strict';
import {
  googleCalendarAdapter,
  microsoftGraphCalendarAdapter,
  executeCalendarSync,
  signOAuthState,
  verifyOAuthState
} from '../src/calendar-sync.mjs';

test('Calendar Sync OAuth State signing and verification', () => {
  const secretKey = 'super-secret-vault-master-key-32bytes!';
  const payload = {
    tenantId: 'agency_123',
    locationId: 'loc_456',
    calendarId: 'cal_789',
    provider: 'google_calendar',
    createdAt: Date.now()
  };

  const state = signOAuthState(payload, secretKey);
  assert.ok(typeof state === 'string' && state.includes('.'));

  const verified = verifyOAuthState(state, secretKey);
  assert.equal(verified.tenantId, payload.tenantId);
  assert.equal(verified.calendarId, payload.calendarId);

  // Rejection with tampered key
  assert.throws(() => {
    verifyOAuthState(state, 'wrong-key-invalid-signature-12345');
  }, { code: 'OAUTH_STATE_INVALID' });

  // Rejection when expired
  const expiredPayload = { ...payload, createdAt: Date.now() - 700_000 };
  const expiredState = signOAuthState(expiredPayload, secretKey);
  assert.throws(() => {
    verifyOAuthState(expiredState, secretKey, 600_000);
  }, { code: 'OAUTH_STATE_EXPIRED' });
});

test('Google Calendar Adapter Verification & Operations', async (t) => {
  await t.test('Verification fails strictly when token is rejected by Google API (401)', async () => {
    const mockFetch = async (url) => {
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: { code: 401, message: 'Invalid Credentials' } })
      };
    };

    const res = await googleCalendarAdapter.verify({
      accessToken: 'bad_token_123',
      fetchFn: mockFetch
    });

    assert.equal(res.verified, false);
    assert.equal(res.code, 'CALENDAR_AUTH_FAILED');
  });

  await t.test('Verification succeeds and retrieves primary calendar metadata', async () => {
    const mockFetch = async (url) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test@operza.io',
          summary: 'Operza Consultations'
        })
      };
    };

    const res = await googleCalendarAdapter.verify({
      accessToken: 'valid_google_token',
      fetchFn: mockFetch
    });

    assert.equal(res.verified, true);
    assert.equal(res.email, 'test@operza.io');
    assert.equal(res.calendarName, 'Operza Consultations');
  });

  await t.test('fetchEvents retrieves and normalizes Google calendar events', async () => {
    const mockFetch = async (url) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 'g_event_1',
              summary: 'Client Strategic Session',
              start: { dateTime: '2026-11-20T10:00:00Z' },
              end: { dateTime: '2026-11-20T11:00:00Z' },
              status: 'confirmed'
            },
            {
              id: 'g_event_cancelled',
              summary: 'Cancelled meeting',
              start: { dateTime: '2026-11-20T12:00:00Z' },
              end: { dateTime: '2026-11-20T13:00:00Z' },
              status: 'cancelled'
            }
          ]
        })
      };
    };

    const events = await googleCalendarAdapter.fetchEvents({
      accessToken: 'valid_token',
      fetchFn: mockFetch
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].id, 'g_event_1');
    assert.equal(events[0].title, 'Client Strategic Session');
    assert.equal(events[0].startsAt, '2026-11-20T10:00:00Z');
  });
});

test('Microsoft Graph Calendar Adapter Verification & Operations', async (t) => {
  await t.test('Verification fails strictly on 401 Unauthorized', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'InvalidAuthenticationToken' } })
    });

    const res = await microsoftGraphCalendarAdapter.verify({
      accessToken: 'bad_token',
      fetchFn: mockFetch
    });

    assert.equal(res.verified, false);
    assert.equal(res.code, 'CALENDAR_AUTH_FAILED');
  });

  await t.test('createEvent maps and dispatches to Microsoft Graph', async () => {
    let capturedBody = null;
    const mockFetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: 'ms_event_99',
          webLink: 'https://outlook.office.com/events/ms_event_99'
        })
      };
    };

    const res = await microsoftGraphCalendarAdapter.createEvent({
      accessToken: 'ms_valid_token',
      event: {
        title: 'Executive Architecture Review',
        startsAt: '2026-11-22T14:00:00Z',
        endsAt: '2026-11-22T15:00:00Z',
        notes: 'Reviewing Operza launch'
      },
      fetchFn: mockFetch
    });

    assert.equal(res.externalId, 'ms_event_99');
    assert.equal(capturedBody.subject, 'Executive Architecture Review');
    assert.equal(capturedBody.start.timeZone, 'UTC');
  });
});

test('Unified executeCalendarSync handles 2-way sync and prevents unverified connections', async (t) => {
  await t.test('Rejects sync when credentials fail provider verification', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' })
    });

    await assert.rejects(
      async () => {
        await executeCalendarSync({
          calendar: {
            id: 'cal_1',
            externalSync: { provider: 'google_calendar', accessToken: 'invalid_token' }
          },
          fetchFn: mockFetch
        });
      },
      { code: 'CALENDAR_AUTH_FAILED' }
    );
  });

  await t.test('Performs two-way sync: imports busy blocks and exports unexported appointments', async () => {
    const mockFetch = async (url, opts) => {
      // 1. Verify call
      if (url.includes('/users/me/calendarList/primary')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'cal_primary', summary: 'Primary' })
        };
      }
      // 2. Fetch events call
      if (url.includes('/calendars/primary/events') && (!opts || opts.method === 'GET' || !opts.method)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 'external_busy_1',
                summary: 'Doctor Appointment',
                start: { dateTime: '2026-11-25T09:00:00Z' },
                end: { dateTime: '2026-11-25T10:00:00Z' },
                status: 'confirmed'
              }
            ]
          })
        };
      }
      // 3. Create event call (export)
      if (url.includes('/calendars/primary/events') && opts?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'exported_evt_42', htmlLink: 'https://cal.google.com/event42' })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const appointments = [
      {
        id: 'appt_local_1',
        calendarId: 'cal_1',
        title: 'Strategy Consultation',
        startsAt: '2026-11-26T15:00:00Z',
        endsAt: '2026-11-26T15:30:00Z',
        status: 'confirmed'
      }
    ];

    const result = await executeCalendarSync({
      calendar: {
        id: 'cal_1',
        externalSync: { provider: 'google_calendar', accessToken: 'valid_access_token' }
      },
      appointments,
      syncDirection: 'two_way',
      fetchFn: mockFetch
    });

    assert.equal(result.success, true);
    assert.equal(result.busyBlocksCount, 1);
    assert.equal(result.busyBlocks[0].title, 'Doctor Appointment');
    assert.equal(result.exportedCount, 1);
    assert.equal(appointments[0].externalEventId, 'exported_evt_42');
  });
});
