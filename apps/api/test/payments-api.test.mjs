import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePaymentsRoutes } from '../routes/payments.mjs';
import { handleFunnelsRoutes } from '../routes/funnels.mjs';

function createMockHttpExchange({ method, url, body = null, headers = {} }) {
  const req = { method, url, headers: { host: 'localhost:4005', ...headers } };
  let statusCode = 200;
  let responseData = null;
  const res = {
    headersSent: false,
    writeHead(code) { statusCode = code; this.headersSent = true; },
    end(chunk) { if (chunk) responseData = chunk; this.headersSent = true; }
  };
  return {
    req,
    res,
    sendJson: (r, status, payload) => { r.writeHead(status); r.end(JSON.stringify(payload)); },
    readBody: async () => body || {},
    readRawBody: async () => Buffer.from(JSON.stringify(body || {})),
    getResult: () => ({ status: statusCode, body: responseData ? JSON.parse(responseData) : null })
  };
}

test('Payments API — Scope checks, tenant ID stripping & public checkout validation', async () => {
  const agencyId = '11111111-1111-4111-8111-111111111111';
  const locationId = '22222222-2222-4222-8222-222222222222';
  const state = {
    records: {
      paymentLinks: [{ id: 'pl-1', agencyId, locationId, name: 'Retainer', slug: 'retainer', amount: 500, currency: 'USD', active: true }],
      products: [],
      contacts: [],
      coupons: [],
      orders: [],
      invoices: [],
      payments: [],
      opportunities: []
    }
  };

  const baseCtx = {
    state,
    saveState: async () => {},
    auditLog: () => {},
    broadcast: () => {},
    actor: { user: { id: 'u1' } },
    agency: { id: agencyId },
    activeLocation: { id: locationId },
    pgPool: null,
    triggerWorkflowExecution: async () => {},
    isWebhookReplay: () => false
  };

  // 1. Checkout missing payment method fails with 400
  const badChk = createMockHttpExchange({
    method: 'POST',
    url: '/api/payments/checkout/retainer',
    body: { customerName: 'Jane Doe', customerEmail: 'jane@example.com' }
  });
  await handlePaymentsRoutes(badChk.req, badChk.res, {
    ...baseCtx,
    actor: undefined, agency: undefined, activeLocation: undefined,
    method: 'POST', pathname: '/api/payments/checkout/retainer',
    readBody: badChk.readBody, sendJson: badChk.sendJson
  });
  assert.equal(badChk.getResult().status, 400);

  // 2. API key scope check rejects orders write without orders:write
  const scopedEx = createMockHttpExchange({ method: 'POST', url: '/api/crm/orders', body: { amount: 100 } });
  await handlePaymentsRoutes(scopedEx.req, scopedEx.res, {
    ...baseCtx,
    actor: { apiKey: true, scopes: ['contacts:read'] },
    method: 'POST', pathname: '/api/crm/orders',
    readBody: scopedEx.readBody, sendJson: scopedEx.sendJson
  });
  assert.equal(scopedEx.getResult().status, 403);
});

test('Funnels API — Zero dual-truth financial writes when pgPool is configured', async () => {
  const agencyId = '11111111-1111-4111-8111-111111111111';
  const locationId = '22222222-2222-4222-8222-222222222222';
  const orderId = '33333333-3333-4333-8333-333333333333';

  const state = {
    records: {
      websites: [],
      contacts: [],
      opportunities: [],
      orders: [],
      payments: [],
      invoices: []
    }
  };

  const mockPgPool = {
    async query(sql) {
      if (sql.includes('FROM orders')) {
        return {
          rows: [{
            id: orderId, agency_id: agencyId, location_id: locationId, order_number: 'ORD-100',
            contact_id: null, amount_cents: 10000, currency: 'USD', status: 'paid', items: []
          }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      return {
        async query(sql, params = []) {
          const norm = sql.replace(/\s+/g, ' ').trim();
          if (norm === 'BEGIN' || norm === 'COMMIT' || norm === 'ROLLBACK' || norm.includes('set_config')) {
            return { rows: [], rowCount: 0 };
          }
          if (norm.startsWith('SELECT * FROM orders WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
            return {
              rows: [{
                id: orderId, agency_id: agencyId, location_id: locationId, order_number: 'ORD-100',
                contact_id: null, amount_cents: 10000, currency: 'USD', status: 'paid', items: []
              }],
              rowCount: 1
            };
          }
          if (norm.startsWith('UPDATE orders SET')) {
            return {
              rows: [{
                id: orderId, agency_id: agencyId, location_id: locationId, order_number: 'ORD-100',
                contact_id: null, amount_cents: params[0], currency: 'USD', status: params[1],
                items: JSON.parse(params[2]), has_upsell: true
              }],
              rowCount: 1
            };
          }
          if (norm.startsWith('INSERT INTO payments')) {
            return {
              rows: [{
                id: params[0], agency_id: agencyId, location_id: locationId, order_id: orderId,
                amount_cents: params[6], refunded_cents: 0, currency: 'USD', status: 'succeeded', method: 'stripe_tokenized_1click'
              }],
              rowCount: 1
            };
          }
          if (norm.startsWith('INSERT INTO billing_ledger_accounts')) {
            return {
              rows: [{
                id: params[0], agency_id: agencyId, location_id: locationId,
                account_type: params[3], balance_cents: 0, currency: 'USD'
              }],
              rowCount: 1
            };
          }
          if (norm.startsWith('INSERT INTO billing_ledger_entries')) {
            return {
              rows: [{
                id: params[0], agency_id: agencyId, location_id: locationId,
                account_id: params[3], entry_type: params[4], amount_cents: params[5],
                running_balance_cents: params[6], reference_type: params[7], reference_id: params[8],
                checksum: params[10]
              }],
              rowCount: 1
            };
          }
          if (norm.startsWith('UPDATE billing_ledger_accounts')) {
            return {
              rows: [{
                id: params[3], agency_id: agencyId, location_id: locationId,
                account_type: 'stripe_escrow', balance_cents: params[0], currency: 'USD'
              }],
              rowCount: 1
            };
          }
          return { rows: [], rowCount: 0 };
        },
        release() {}
      };
    }
  };

  const upsellEx = createMockHttpExchange({
    method: 'POST',
    url: '/api/funnels/checkout/one-click-upsell',
    body: { orderId, product: { name: 'VIP Upsell', price: 97 } }
  });

  await handleFunnelsRoutes(upsellEx.req, upsellEx.res, {
    state,
    saveState: async () => {},
    auditLog: () => {},
    broadcast: () => {},
    actor: undefined,
    agency: undefined,
    activeLocation: undefined,
    pgPool: mockPgPool,
    method: 'POST',
    pathname: '/api/funnels/checkout/one-click-upsell',
    readBody: upsellEx.readBody,
    sendJson: upsellEx.sendJson
  });

  const res = upsellEx.getResult();
  assert.equal(res.status, 200);
  assert.equal(res.body.order.amount, 197);
  assert.equal(state.records.orders.length, 0, 'Must NOT write orders to state.records when pgPool is configured');
  assert.equal(state.records.payments.length, 0, 'Must NOT write payments to state.records when pgPool is configured');
});
