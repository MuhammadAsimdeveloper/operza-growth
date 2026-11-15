import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resendEmailAdapter,
  sendgridEmailAdapter,
  twilioSmsAdapter,
  whatsappMetaAdapter,
  stripePaymentAdapter,
  createProviderAdapterRegistry
} from '../src/provider-adapters.mjs';

test('API-key shape alone never verifies a Resend connection', async () => {
  const validShape = await resendEmailAdapter.verify({
    secret: 're_test_999888777666',
    config: { senderEmail: 'ops@operza.io' }
  });
  assert.equal(validShape.verified, false);
  assert.equal(validShape.code, 'PROVIDER_ADAPTER_UNAVAILABLE');

  const invalid = await resendEmailAdapter.verify({ secret: 'invalid-key' });
  assert.equal(invalid.verified, false);
  assert.equal(invalid.code, 'INVALID_PROVIDER_CREDENTIAL');
});

test('API-key shape alone never verifies SendGrid, Twilio, Meta or Stripe', async () => {
  const cases = [
    [sendgridEmailAdapter, { secret: 'SG.valid-shaped-test-token-000000' }],
    [twilioSmsAdapter, { secret: 'auth_token_secret_12345678', config: { accountId: 'AC1234567890abcdef' } }],
    [whatsappMetaAdapter, { secret: 'meta-token-valid-shaped-1234567890', config: { phoneNumberId: '1234567890' } }],
    [stripePaymentAdapter, { secret: 'sk_test_51Mzxyz123456789012345678' }]
  ];
  for (const [adapter, input] of cases) {
    const result = await adapter.verify(input);
    assert.equal(result.verified, false);
    assert.equal(result.code, 'PROVIDER_ADAPTER_UNAVAILABLE');
  }
});

test('non-live provider adapters never manufacture successful delivery receipts', async () => {
  const adapters = [resendEmailAdapter, sendgridEmailAdapter, twilioSmsAdapter, whatsappMetaAdapter];
  for (const adapter of adapters) {
    const result = await adapter.dispatch({ consent: { status: 'granted' }, payload: {} });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PROVIDER_ADAPTER_UNAVAILABLE');
  }
  const stripe = await stripePaymentAdapter.dispatch({});
  assert.equal(stripe.ok, false);
  assert.equal(stripe.code, 'PAYMENTS_DISABLED');
});

test('createProviderAdapterRegistry indexes all catalog adapters and supports overrides', () => {
  const registry = createProviderAdapterRegistry();
  assert.ok(registry.has('email.resend'));
  assert.ok(registry.has('sms.twilio'));
  assert.ok(registry.has('payments.stripe'));
  assert.ok(registry.has('email.microsoft_graph') === false);

  const custom = { providerKey: 'email.microsoft_graph', id: 'outlook-test' };
  const withOutlook = createProviderAdapterRegistry([custom]);
  assert.equal(withOutlook.get('email.microsoft_graph').id, 'outlook-test');
});
