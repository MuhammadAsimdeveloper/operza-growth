import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { stripePaymentAdapter } from '../../../packages/platform-core/src/provider-adapters.mjs';
import { handlePaymentsRoutes } from '../routes/payments.mjs';

test('stripePaymentAdapter: sandbox verify, createPaymentIntent, and createRefund use Idempotency-Key and fail closed on invalid creds', async () => {
  const badVerify = await stripePaymentAdapter.verify({ secret: 'not_a_stripe_key' });
  assert.equal(badVerify.verified, false);
  assert.equal(badVerify.code, 'INVALID_CREDENTIAL_FORMAT');

  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/account')) {
      return new Response(JSON.stringify({ id: 'acct_test_123', charges_enabled: true, payouts_enabled: true }), { status: 200 });
    }
    if (url.endsWith('/v1/payment_intents')) {
      return new Response(JSON.stringify({ id: 'pi_test_999', status: 'succeeded', amount: 25000, currency: 'usd' }), { status: 200 });
    }
    if (url.endsWith('/v1/refunds')) {
      return new Response(JSON.stringify({ id: 're_test_555', status: 'succeeded', amount: 5000 }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };

  const okVerify = await stripePaymentAdapter.verify({ secret: 'sk_test_1234567890abcdef', fetchFn: mockFetch });
  assert.equal(okVerify.verified, true);
  assert.equal(okVerify.mode, 'sandbox');
  assert.equal(okVerify.chargesEnabled, true);

  const intent = await stripePaymentAdapter.createPaymentIntent({
    secret: 'sk_test_1234567890abcdef',
    amountCents: 25000,
    currency: 'USD',
    idempotencyKey: 'pi_idem_1',
    fetchFn: mockFetch
  });
  assert.equal(intent.ok, true);
  assert.equal(intent.providerPaymentId, 'pi_test_999');
  assert.equal(calls[1].init.headers['Idempotency-Key'], 'pi_idem_1');

  const refund = await stripePaymentAdapter.createRefund({
    secret: 'sk_test_1234567890abcdef',
    paymentIntentId: 'pi_test_999',
    amountCents: 5000,
    idempotencyKey: 're_idem_1',
    fetchFn: mockFetch
  });
  assert.equal(refund.ok, true);
  assert.equal(refund.refundId, 're_test_555');
  assert.equal(calls[2].init.headers['Idempotency-Key'], 're_idem_1');
});

test('Payments API: GET /api/invoices/:id/pdf returns %PDF-1.4 for owning tenant and 404 cross-tenant', async () => {
  const state = {
    records: {
      invoices: [
        {
          id: 'inv-1',
          agencyId: 'agency-1',
          locationId: 'loc-1',
          number: 'INV-1001',
          contactName: 'Alice Client',
          amount: 500,
          currency: 'USD',
          status: 'paid',
          lineItems: [{ description: 'SEO Retainer', quantity: 1, unitPrice: 500 }]
        }
      ]
    }
  };

  let sentStatus = 0;
  let sentHeaders = {};
  let sentBody = null;
  const res = {
    writeHead(status, headers) {
      sentStatus = status;
      sentHeaders = headers || {};
    },
    end(body) {
      sentBody = body;
    }
  };

  const handled = await handlePaymentsRoutes(
    { method: 'GET', url: '/api/invoices/inv-1/pdf', headers: { host: 'localhost' } },
    res,
    {
      method: 'GET',
      pathname: '/api/invoices/inv-1/pdf',
      readBody: async () => ({}),
      readRawBody: async () => Buffer.alloc(0),
      sendJson: (_r, code, payload) => { sentStatus = code; sentBody = payload; },
      state,
      saveState: async () => {},
      auditLog: () => {},
      broadcast: () => {},
      actor: { user: { id: 'u1', role: 'owner' } },
      agency: { id: 'agency-1', name: 'Operza Agency' },
      activeLocation: { id: 'loc-1', name: 'Main' },
      pgPool: null,
      isWebhookReplay: () => false,
      logStructured: () => {}
    }
  );
  assert.equal(handled, true);
  assert.equal(sentStatus, 200);
  assert.equal(sentHeaders['content-type'], 'application/pdf');
  assert.ok(Buffer.isBuffer(sentBody));
  assert.ok(sentBody.toString('latin1').startsWith('%PDF-1.4'));

  // Cross-tenant isolation check
  let crossStatus = 0;
  await handlePaymentsRoutes(
    { method: 'GET', url: '/api/invoices/inv-1/pdf', headers: { host: 'localhost' } },
    { writeHead() {}, end() {} },
    {
      method: 'GET',
      pathname: '/api/invoices/inv-1/pdf',
      readBody: async () => ({}),
      readRawBody: async () => Buffer.alloc(0),
      sendJson: (_r, code) => { crossStatus = code; },
      state,
      saveState: async () => {},
      auditLog: () => {},
      broadcast: () => {},
      actor: { user: { id: 'u2', role: 'owner' } },
      agency: { id: 'agency-2', name: 'Other Agency' },
      activeLocation: { id: 'loc-2', name: 'Other' },
      pgPool: null,
      isWebhookReplay: () => false,
      logStructured: () => {}
    }
  );
  assert.equal(crossStatus, 404);
});
