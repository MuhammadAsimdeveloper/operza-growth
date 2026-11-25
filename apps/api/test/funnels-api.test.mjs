import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFunnelsRoutes } from '../routes/funnels.mjs';

function createMockHttpExchange({ method, url, body = null, headers = {} }) {
  const req = {
    method,
    url,
    headers: { host: 'localhost:4005', ...headers }
  };

  let statusCode = 200;
  let responseData = null;

  const res = {
    headersSent: false,
    writeHead(code) {
      statusCode = code;
      this.headersSent = true;
    },
    end(chunk) {
      if (chunk) responseData = chunk;
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

test('Funnels API — CRM CRUD, public visit, cross-domain optin & 1-click upsell', async () => {
  const agencyId = '11111111-1111-4111-8111-111111111111';
  const locationId = '22222222-2222-4222-8222-222222222222';

  const state = {
    agencies: [{ id: agencyId, name: 'Main Agency' }],
    locations: [{ id: locationId, agencyId, name: 'Main Location' }],
    records: {
      websites: [],
      contacts: [],
      opportunities: [],
      orders: [{ id: 'ord-1', agencyId, locationId, contactId: 'c-1', amount: 100, items: [], currency: 'USD' }],
      payments: []
    }
  };

  let triggeredWorkflow = null;

  const baseCtx = {
    state,
    saveState: async () => {},
    auditLog: () => {},
    broadcast: () => {},
    actor: { user: { id: 'user-1' } },
    agency: { id: agencyId, name: 'Main Agency' },
    activeLocation: { id: locationId, name: 'Main Location' },
    pgPool: null,
    triggerWorkflowExecution: async (payload) => { triggeredWorkflow = payload; }
  };

  // 1. Create funnel via POST /api/crm/websites
  const createEx = createMockHttpExchange({
    method: 'POST',
    url: '/api/crm/websites',
    body: {
      name: 'Scale Funnel',
      slug: 'scale-funnel',
      kind: 'funnel',
      published: true,
      pages: [{ id: 'p1', slug: 'optin', title: 'Optin Page' }]
    }
  });

  const handledCreate = await handleFunnelsRoutes(createEx.req, createEx.res, {
    ...baseCtx,
    method: 'POST',
    pathname: '/api/crm/websites',
    readBody: createEx.readBody,
    sendJson: createEx.sendJson
  });
  assert.equal(handledCreate, true);
  assert.equal(createEx.getResult().status, 201);

  // 2. Public visit GET /api/funnels/public/scale-funnel
  const visitEx = createMockHttpExchange({ method: 'GET', url: '/api/funnels/public/scale-funnel?pageSlug=optin' });
  await handleFunnelsRoutes(visitEx.req, visitEx.res, {
    ...baseCtx,
    actor: undefined,
    agency: undefined,
    activeLocation: undefined,
    method: 'GET',
    pathname: '/api/funnels/public/scale-funnel',
    url: new URL('http://localhost:4005/api/funnels/public/scale-funnel?pageSlug=optin'),
    readBody: visitEx.readBody,
    sendJson: visitEx.sendJson
  });
  assert.equal(visitEx.getResult().status, 200);
  assert.equal(visitEx.getResult().body.visits, 1);

  // 3. Public opt-in POST /api/funnels/optin/scale-funnel
  const optinEx = createMockHttpExchange({
    method: 'POST',
    url: '/api/funnels/optin/scale-funnel',
    body: { firstName: 'Elena', lastName: 'Rostova', email: 'elena@example.com', pageSlug: 'optin' }
  });
  await handleFunnelsRoutes(optinEx.req, optinEx.res, {
    ...baseCtx,
    actor: undefined,
    agency: undefined,
    activeLocation: undefined,
    method: 'POST',
    pathname: '/api/funnels/optin/scale-funnel',
    readBody: optinEx.readBody,
    sendJson: optinEx.sendJson
  });
  const optinRes = optinEx.getResult();
  assert.equal(optinRes.status, 201);
  assert.equal(state.records.contacts.length, 1);
  assert.equal(state.records.opportunities.length, 1);
  assert.ok(triggeredWorkflow, 'Opt-in must trigger workflow execution');

  // 4. 1-click upsell POST /api/funnels/checkout/one-click-upsell
  const upsellEx = createMockHttpExchange({
    method: 'POST',
    url: '/api/funnels/checkout/one-click-upsell',
    body: { orderId: 'ord-1', product: { name: 'VIP Pack', price: 97 } }
  });
  await handleFunnelsRoutes(upsellEx.req, upsellEx.res, {
    ...baseCtx,
    actor: undefined,
    agency: undefined,
    activeLocation: undefined,
    method: 'POST',
    pathname: '/api/funnels/checkout/one-click-upsell',
    readBody: upsellEx.readBody,
    sendJson: upsellEx.sendJson
  });
  const upsellRes = upsellEx.getResult();
  assert.equal(upsellRes.status, 200);
  assert.equal(upsellRes.body.order.amount, 197);
  assert.equal(state.records.payments.length, 1);
});
