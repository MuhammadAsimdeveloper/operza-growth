import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSchedulingRoutes } from '../routes/scheduling.mjs';

function createMockHttpExchange({ method, url, body = null, headers = {} }) {
  const req = {
    method,
    url,
    headers: {
      host: 'localhost:4005',
      ...headers
    }
  };

  let statusCode = 200;
  let responseHeaders = {};
  let responseData = null;

  const res = {
    headersSent: false,
    writeHead(code, headers = {}) {
      statusCode = code;
      responseHeaders = { ...responseHeaders, ...headers };
      this.headersSent = true;
    },
    end(chunk) {
      if (chunk) {
        responseData = chunk;
      }
      this.headersSent = true;
    }
  };

  const sendJson = (response, status, payload) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  };

  const readBody = async () => body || {};

  return {
    req,
    res,
    sendJson,
    readBody,
    getResult: () => ({
      status: statusCode,
      body: responseData ? JSON.parse(responseData) : null
    })
  };
}

test('Scheduling API — Comprehensive HTTP contract, validation & public booking', async () => {
  const agencyId = '11111111-1111-4111-8111-111111111111';
  const locationId = '22222222-2222-4222-8222-222222222222';
  const foreignAgencyId = '99999999-9999-4999-8999-999999999999';

  const state = {
    records: {
      calendars: [],
      appointments: [],
      contacts: [],
      tasks: []
    }
  };

  let workflowTriggered = null;
  let zapierEvent = null;

  const baseCtx = {
    state,
    saveState: async () => {},
    auditLog: () => {},
    broadcast: () => {},
    actor: { user: { id: 'user-1' } },
    agency: { id: agencyId, name: 'Main Agency' },
    activeLocation: { id: locationId, name: 'Primary Location' },
    pgPool: null, // Test in-memory / zero-config mode
    triggerWorkflowExecution: async (payload) => { workflowTriggered = payload; },
    dispatchZapierEvent: async (payload) => { zapierEvent = payload; }
  };

  // 1. Create a calendar via POST /api/crm/calendars
  const createCalEx = createMockHttpExchange({
    method: 'POST',
    url: '/api/crm/calendars',
    body: {
      name: 'Discovery Consultation',
      slug: 'discovery-consult',
      durationMin: 30,
      description: 'Meet with senior consultant'
    }
  });

  const handledCalCreate = await handleSchedulingRoutes(createCalEx.req, createCalEx.res, {
    ...baseCtx,
    method: 'POST',
    pathname: '/api/crm/calendars',
    readBody: createCalEx.readBody,
    sendJson: createCalEx.sendJson
  });

  assert.equal(handledCalCreate, true);
  const calCreateRes = createCalEx.getResult();
  assert.equal(calCreateRes.status, 201);
  assert.equal(calCreateRes.body.name, 'Discovery Consultation');
  assert.equal(calCreateRes.body.slug, 'discovery-consult');
  const calendarId = calCreateRes.body.id;

  // 2. Query public calendar availability: GET /api/calendars/public/discovery-consult?date=2026-12-10
  const pubCalEx = createMockHttpExchange({
    method: 'GET',
    url: '/api/calendars/public/discovery-consult?date=2026-12-10'
  });

  const handledPubCal = await handleSchedulingRoutes(pubCalEx.req, pubCalEx.res, {
    ...baseCtx,
    method: 'GET',
    pathname: '/api/calendars/public/discovery-consult',
    url: new URL('http://localhost:4005/api/calendars/public/discovery-consult?date=2026-12-10'),
    sendJson: pubCalEx.sendJson
  });

  assert.equal(handledPubCal, true);
  const pubCalRes = pubCalEx.getResult();
  assert.equal(pubCalRes.status, 200);
  assert.ok(Array.isArray(pubCalRes.body.availableSlots));
  assert.ok(pubCalRes.body.availableSlots.includes('10:00'));

  // 3. Book public appointment: POST /api/calendars/book/discovery-consult
  const bookEx = createMockHttpExchange({
    method: 'POST',
    url: '/api/calendars/book/discovery-consult',
    body: {
      name: 'Elena Rostova',
      email: 'elena@example.com',
      phone: '+1 555-0144',
      date: '2026-12-10',
      timeSlot: '10:00',
      notes: 'Interested in enterprise growth package'
    }
  });

  const handledBook = await handleSchedulingRoutes(bookEx.req, bookEx.res, {
    ...baseCtx,
    method: 'POST',
    pathname: '/api/calendars/book/discovery-consult',
    readBody: bookEx.readBody,
    sendJson: bookEx.sendJson
  });

  assert.equal(handledBook, true);
  const bookRes = bookEx.getResult();
  assert.equal(bookRes.status, 201);
  assert.equal(bookRes.body.success, true);
  assert.equal(bookRes.body.appointment.calendarId, calendarId);
  assert.equal(bookRes.body.appointment.startsAt, '2026-12-10T10:00:00.000Z');
  assert.equal(bookRes.body.contact.email, 'elena@example.com');
  assert.ok(bookRes.body.prepTask);

  // 4. Overlapping booking on same slot should be rejected with 409
  const conflictEx = createMockHttpExchange({
    method: 'POST',
    url: '/api/calendars/book/discovery-consult',
    body: {
      name: 'Duplicate Booker',
      email: 'dup@example.com',
      date: '2026-12-10',
      timeSlot: '10:00'
    }
  });

  const handledConflict = await handleSchedulingRoutes(conflictEx.req, conflictEx.res, {
    ...baseCtx,
    method: 'POST',
    pathname: '/api/calendars/book/discovery-consult',
    readBody: conflictEx.readBody,
    sendJson: conflictEx.sendJson
  });

  assert.equal(handledConflict, true);
  const conflictRes = conflictEx.getResult();
  assert.equal(conflictRes.status, 409);

  // 5. Foreign tenant isolation: querying calendars under different agency returns empty
  const foreignEx = createMockHttpExchange({
    method: 'GET',
    url: '/api/crm/calendars'
  });

  const handledForeign = await handleSchedulingRoutes(foreignEx.req, foreignEx.res, {
    ...baseCtx,
    agency: { id: foreignAgencyId, name: 'Foreign Agency' },
    activeLocation: { id: 'some-other-loc', name: 'Other Location' },
    method: 'GET',
    pathname: '/api/crm/calendars',
    sendJson: foreignEx.sendJson
  });

  assert.equal(handledForeign, true);
  const foreignRes = foreignEx.getResult();
  assert.equal(foreignRes.status, 200);
  assert.equal(foreignRes.body.calendars.length, 0);
});
