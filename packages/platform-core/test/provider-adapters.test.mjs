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

test('Resend adapter verifies valid re_ keys and rejects malformed keys', async () => {
  const valid = await resendEmailAdapter.verify({
    secret: 're_test_999888777666',
    config: { senderEmail: 'ops@operza.io' }
  });
  assert.equal(valid.verified, true);
  assert.equal(valid.accountId, 'resend:ops@operza.io');

  const invalid = await resendEmailAdapter.verify({ secret: 'invalid-key' });
  assert.equal(invalid.verified, false);
});

test('Twilio adapter verifies valid tokens and account SIDs', async () => {
  const valid = await twilioSmsAdapter.verify({
    secret: 'auth_token_secret_12345678',
    config: { accountId: 'AC1234567890abcdef' }
  });
  assert.equal(valid.verified, true);
  assert.equal(valid.accountId, 'AC1234567890abcdef');

  const invalid = await twilioSmsAdapter.verify({
    secret: 'short',
    config: { accountId: 'INVALID' }
  });
  assert.equal(invalid.verified, false);
});

test('Stripe adapter verifies sk_ secret keys', async () => {
  const valid = await stripePaymentAdapter.verify({
    secret: 'sk_test_51Mzxyz123456789012345678'
  });
  assert.equal(valid.verified, true);

  const invalid = await stripePaymentAdapter.verify({
    secret: 'pk_test_public_key'
  });
  assert.equal(invalid.verified, false);
});

test('createProviderAdapterRegistry indexes and lists adapters', () => {
  const registry = createProviderAdapterRegistry();
  assert.ok(registry.has('email.resend'));
  assert.ok(registry.has('sms.twilio'));
  assert.ok(registry.has('payments.stripe'));

  const resend = registry.get('email.resend');
  assert.equal(resend.id, 'adapter-resend-email-v1');
});
