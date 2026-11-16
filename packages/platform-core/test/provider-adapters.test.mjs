import test from 'node:test';
import assert from 'node:assert/strict';
import { resendEmailAdapter, sendgridEmailAdapter, twilioSmsAdapter, whatsappMetaAdapter, stripePaymentAdapter, createProviderAdapterRegistry } from '../src/provider-adapters.mjs';

const sid = 'AC' + 'a'.repeat(32);
const consent = (channel, contactId) => ({ status: 'granted', channel, contactId, purpose: 'transactional' });
const response = (status, data = {}, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => headers[name.toLowerCase()] || null },
  json: async () => data
});

test('Resend validates credentials against its real API', async () => {
  let seen;
  const result = await resendEmailAdapter.verify({
    secret: 're_' + 'x'.repeat(20),
    fetchFn: async (url, options) => { seen = { url, options }; return response(200, { data: [] }); }
  });
  assert.equal(result.verified, true);
  assert.equal(seen.url, 'https://api.resend.com/domains?limit=1');
});

test('Resend sends email and uses the actual provider receipt', async () => {
  let seen;
  const result = await resendEmailAdapter.dispatch({
    secret: 're_' + 'x'.repeat(20),
    config: { senderEmail: 'sales@example.com' },
    payload: { contactId: 'c1', to: 'buyer@example.com', subject: 'Welcome', text: 'Hello' },
    consent: consent('email', 'c1'),
    tenantId: 'tenant1', locationId: 'loc1', actionHash: 'a'.repeat(64),
    fetchFn: async (url, options) => { seen = { url, options }; return response(200, { id: 'resend_real_receipt' }); }
  });
  assert.equal(result.ok, true);
  assert.equal(result.providerMessageId, 'resend_real_receipt');
  assert.equal(seen.url, 'https://api.resend.com/emails');
  assert.ok(seen.options.headers['Idempotency-Key']);
});

test('SendGrid only reports success on its accepted status', async () => {
  let seen;
  const result = await sendgridEmailAdapter.dispatch({
    secret: 'SG.' + 'x'.repeat(12) + '.' + 'y'.repeat(12),
    config: { senderEmail: 'sales@example.com' },
    payload: { contactId: 'c2', to: 'buyer@example.com', subject: 'Welcome', html: '<p>Hello</p>' },
    consent: consent('email', 'c2'),
    fetchFn: async (url, options) => { seen = { url, options }; return response(202, {}, { 'x-message-id': 'sendgrid_real_receipt' }); }
  });
  assert.equal(result.ok, true);
  assert.equal(result.providerMessageId, 'sendgrid_real_receipt');
  assert.equal(seen.url, 'https://api.sendgrid.com/v3/mail/send');
  const rejected = await sendgridEmailAdapter.dispatch({
    secret: 'SG.' + 'x'.repeat(12) + '.' + 'y'.repeat(12),
    config: { senderEmail: 'sales@example.com' },
    payload: { contactId: 'c2', to: 'buyer@example.com', subject: 'Welcome', text: 'Hello' },
    consent: consent('email', 'c2'), fetchFn: async () => response(200, {})
  });
  assert.equal(rejected.ok, false);
});

test('Twilio checks account credentials and returns only the provider message SID', async () => {
  let seen;
  const verified = await twilioSmsAdapter.verify({
    secret: 'twilio-auth-' + 'x'.repeat(20), config: { accountId: sid },
    fetchFn: async (url, options) => { seen = { url, options }; return response(200, { sid }); }
  });
  assert.equal(verified.verified, true);
  assert.ok(seen.options.headers.Authorization.startsWith('Basic '));
  const sent = await twilioSmsAdapter.dispatch({
    secret: 'twilio-auth-' + 'x'.repeat(20),
    config: { accountId: sid, fromNumber: '+15551234567' },
    payload: { contactId: 'c3', to: '+15557654321', text: 'Confirmed' },
    consent: consent('sms', 'c3'),
    fetchFn: async (url, options) => { seen = { url, options }; return response(201, { sid: 'SM_real_provider_sid' }); }
  });
  assert.equal(sent.ok, true);
  assert.equal(sent.providerMessageId, 'SM_real_provider_sid');
  assert.ok(seen.url.endsWith('/Messages.json'));
});

test('WhatsApp uses Meta Graph and returns actual message ID', async () => {
  let seen;
  const verified = await whatsappMetaAdapter.verify({
    secret: 'meta-token-' + 'x'.repeat(25), config: { phoneNumberId: '123456789012' },
    fetchFn: async (url, options) => { seen = { url, options }; return response(200, { id: '123456789012' }); }
  });
  assert.equal(verified.verified, true);
  assert.ok(seen.url.includes('/v27.0/'));
  const sent = await whatsappMetaAdapter.dispatch({
    secret: 'meta-token-' + 'x'.repeat(25), config: { phoneNumberId: '123456789012' },
    payload: { contactId: 'c4', to: '+15557654321', text: 'Hello' },
    consent: consent('whatsapp', 'c4'),
    fetchFn: async (url, options) => { seen = { url, options }; return response(200, { messages: [{ id: 'wamid.real_provider_id' }] }); }
  });
  assert.equal(sent.ok, true);
  assert.equal(sent.providerMessageId, 'wamid.real_provider_id');
});

test('Dispatch fails closed when contact-specific consent does not match', async () => {
  const result = await resendEmailAdapter.dispatch({
    secret: 're_' + 'x'.repeat(20), config: { senderEmail: 'sales@example.com' },
    payload: { contactId: 'c5', to: 'buyer@example.com', subject: 'A', text: 'B' },
    consent: consent('sms', 'c5'),
    fetchFn: async () => { throw new Error('must not call network'); }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONSENT_REQUIRED');
});

test('Stripe remains disabled and never reports fake success', async () => {
  const result = await stripePaymentAdapter.dispatch({});
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PAYMENTS_DISABLED_PENDING_COMPLIANCE');
});

test('registry exposes implemented providers', () => {
  const registry = createProviderAdapterRegistry();
  assert.equal(registry.has('email.resend'), true);
  assert.equal(registry.has('email.sendgrid'), true);
  assert.equal(registry.has('sms.twilio'), true);
  assert.equal(registry.has('whatsapp.meta_cloud'), true);
  assert.equal(registry.has('payments.stripe'), true);
});
