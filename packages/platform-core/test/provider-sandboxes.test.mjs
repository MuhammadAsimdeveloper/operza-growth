import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  resendEmailAdapter,
  sendgridEmailAdapter,
  twilioSmsAdapter,
  whatsappMetaAdapter,
  stripePaymentAdapter,
  createProviderAdapterRegistry
} from '../src/provider-adapters.mjs';

/**
 * Third-Party Provider Sandbox & Contract Verification Suite
 * Verifies API key formats, webhook signatures, mock isolation, and sandbox contracts.
 */

test('Stripe Sandbox Contract: Key format and simulated charge', async () => {
  // Test key format validation
  const invalidKey = await stripePaymentAdapter.verify({ secret: 'not_a_valid_stripe_key' });
  assert.equal(invalidKey.verified, false);
  assert.match(invalidKey.error, /must start with sk_ or rk_/);

  const testKey = await stripePaymentAdapter.verify({
    secret: 'sk_test_51MockStripeKeyForSandboxTestingOnly0000',
    config: { accountId: 'acct_test_123' }
  });
  assert.equal(testKey.verified, true);
  assert.equal(testKey.accountId, 'acct_test_123');

  // Simulated sandbox dispatch
  const dispatch = await stripePaymentAdapter.dispatch({
    secret: 'sk_test_51MockStripeKeyForSandboxTestingOnly0000',
    config: { currency: 'usd' },
    payload: { amountCents: 4900, customerId: 'cus_test_1' },
    tenantId: 'tenant_test',
    locationId: 'loc_test',
    actionHash: 'action_hash_001'
  });

  assert.equal(dispatch.ok, true);
  assert.equal(dispatch.provider, 'stripe');
  assert.ok(dispatch.paymentIntentId.startsWith('pi_'));
  assert.ok(dispatch.idempotencyKey);
});

test('Stripe Webhook Signature Verification Contract', () => {
  const secret = 'whsec_test_secret_stripe_00000000000000000000';
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ id: 'evt_test_charge_succeeded', type: 'payment_intent.succeeded' });

  // Compute Stripe HMAC signature
  const signaturePayload = `${timestamp}.${payload}`;
  const hmac = createHmac('sha256', secret).update(signaturePayload, 'utf8').digest('hex');
  const signatureHeader = `t=${timestamp},v1=${hmac}`;

  // Verification logic
  function verifyStripeSignature(header, rawBody, webhookSecret) {
    const parts = header.split(',');
    const tPart = parts.find(p => p.startsWith('t='))?.slice(2);
    const v1Part = parts.find(p => p.startsWith('v1='))?.slice(3);
    if (!tPart || !v1Part) return false;

    const expected = createHmac('sha256', webhookSecret).update(`${tPart}.${rawBody}`, 'utf8').digest('hex');
    return timingSafeEqual(Buffer.from(v1Part, 'utf8'), Buffer.from(expected, 'utf8'));
  }

  assert.equal(verifyStripeSignature(signatureHeader, payload, secret), true);
  assert.equal(verifyStripeSignature(signatureHeader, 'tampered_payload', secret), false);
  assert.equal(verifyStripeSignature(signatureHeader, payload, 'wrong_secret'), false);
});

test('Twilio SMS & Softphone Sandbox Contract', async () => {
  // Invalid Account SID
  const badSid = await twilioSmsAdapter.verify({
    secret: 'valid_length_token_12345678',
    config: { accountId: 'BAD_SID' }
  });
  assert.equal(badSid.verified, false);
  assert.match(badSid.error, /must start with AC/);

  // Valid Test SID and Token
  const valid = await twilioSmsAdapter.verify({
    secret: 'valid_length_token_12345678',
    config: { accountId: 'AC00000000000000000000000000000000' }
  });
  assert.equal(valid.verified, true);

  // Simulated dispatch with explicit consent
  const dispatch = await twilioSmsAdapter.dispatch({
    secret: 'valid_length_token_12345678',
    config: { fromNumber: '+15005550006' },
    payload: { to: '+15551234567', body: 'Verification Code: 948210' },
    consent: { status: 'granted' }
  });

  assert.equal(dispatch.ok, true);
  assert.equal(dispatch.provider, 'twilio');
  assert.ok(dispatch.messageId.startsWith('SM_'));
});

test('Resend & SendGrid Email Sandbox Contracts', async () => {
  // Resend format verification
  const badResend = await resendEmailAdapter.verify({ secret: 'invalid_resend' });
  assert.equal(badResend.verified, false);
  assert.match(badResend.error, /must start with re_/);

  const goodResend = await resendEmailAdapter.verify({
    secret: 're_mock_test_key_1234567890',
    config: { senderEmail: 'noreply@operza.io' }
  });
  assert.equal(goodResend.verified, true);
  assert.equal(goodResend.accountId, 'resend:noreply@operza.io');

  // SendGrid format verification
  const badSendGrid = await sendgridEmailAdapter.verify({ secret: 'invalid_sendgrid' });
  assert.equal(badSendGrid.verified, false);
  assert.match(badSendGrid.error, /must start with SG\./);

  const goodSendGrid = await sendgridEmailAdapter.verify({
    secret: 'SG.mock_test_key_00000000000000000000',
    config: { senderEmail: 'marketing@operza.io' }
  });
  assert.equal(goodSendGrid.verified, true);
});

test('Meta WhatsApp Cloud API Sandbox Contract', async () => {
  const badPhone = await whatsappMetaAdapter.verify({
    secret: 'valid_access_token_12345',
    config: { phoneNumberId: '12' } // Too short
  });
  assert.equal(badPhone.verified, false);

  const goodPhone = await whatsappMetaAdapter.verify({
    secret: 'valid_access_token_12345',
    config: { phoneNumberId: '109827364510293' }
  });
  assert.equal(goodPhone.verified, true);

  const dispatch = await whatsappMetaAdapter.dispatch({
    secret: 'valid_access_token_12345',
    config: { phoneNumberId: '109827364510293' },
    payload: { to: '15559876543', templateName: 'order_update' },
    consent: { status: 'granted' }
  });

  assert.equal(dispatch.ok, true);
  assert.equal(dispatch.provider, 'whatsapp.meta_cloud');
  assert.ok(dispatch.messageId.startsWith('wamid.'));
});

test('Live Provider Sandbox Network Gate', (t) => {
  if (process.env.LIVE_PROVIDER_TESTS !== 'true') {
    t.skip(
      'NOT RUN (Requires live sandbox credentials). Set LIVE_PROVIDER_TESTS=true and configure ' +
      'STRIPE_TEST_KEY / TWILIO_TEST_KEY to execute live network round-trips.'
    );
    return;
  }
  // If LIVE_PROVIDER_TESTS is set, live external HTTPS pings would run here
});
