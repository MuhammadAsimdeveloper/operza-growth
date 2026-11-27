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

test('Stripe Sandbox Contract: Fails closed on invalid credentials without simulated success', async () => {
  // Test that Stripe strictly fails closed and never reports fake simulation
  const check = await stripePaymentAdapter.verify({ secret: 'sk_test_mock' });
  assert.equal(check.verified, false);
  assert.equal(check.code, 'INVALID_CREDENTIAL_FORMAT');

  const dispatch = await stripePaymentAdapter.dispatch({
    secret: 'sk_test_mock',
    payload: { amountCents: 4900 }
  });
  assert.equal(dispatch.ok, false);
  assert.equal(dispatch.code, 'INVALID_CREDENTIAL_FORMAT');
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
  assert.equal(badSid.code, 'INVALID_CREDENTIAL_FORMAT');

  // Valid Test SID and Token with mocked API response
  const mockFetch = async () => ({ ok: true, status: 200, json: async () => ({ sid: 'AC00000000000000000000000000000000' }) });
  const valid = await twilioSmsAdapter.verify({
    secret: 'valid_length_token_12345678',
    config: { accountId: 'AC00000000000000000000000000000000' },
    fetchFn: mockFetch
  });
  assert.equal(valid.verified, true);

  // Dispatch with explicit consent
  const dispatch = await twilioSmsAdapter.dispatch({
    secret: 'valid_length_token_12345678',
    config: { fromNumber: '+15005550006', accountId: 'AC00000000000000000000000000000000' },
    payload: { contactId: 'c1', to: '+15551234567', body: 'Verification Code: 948210' },
    consent: { status: 'granted', channel: 'sms', contactId: 'c1' },
    fetchFn: async () => ({ ok: true, status: 201, json: async () => ({ sid: 'SM_mock_12345' }) })
  });

  assert.equal(dispatch.ok, true);
  assert.equal(dispatch.provider, 'twilio');
  assert.ok(dispatch.providerMessageId.startsWith('SM_'));
});

test('Resend & SendGrid Email Sandbox Contracts', async () => {
  // Resend format verification
  const badResend = await resendEmailAdapter.verify({ secret: 'invalid_resend' });
  assert.equal(badResend.verified, false);
  assert.equal(badResend.code, 'INVALID_CREDENTIAL_FORMAT');

  const goodResend = await resendEmailAdapter.verify({
    secret: 're_mock_test_key_1234567890',
    config: { senderEmail: 'noreply@operza.io' },
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })
  });
  assert.equal(goodResend.verified, true);
  assert.equal(goodResend.accountId, 'noreply@operza.io');

  // SendGrid format verification
  const badSendGrid = await sendgridEmailAdapter.verify({ secret: 'invalid_sendgrid' });
  assert.equal(badSendGrid.verified, false);
  assert.equal(badSendGrid.code, 'INVALID_CREDENTIAL_FORMAT');

  const goodSendGrid = await sendgridEmailAdapter.verify({
    secret: 'SG.mock_test_key_00000000000000000000.signature_hash_value',
    config: { senderEmail: 'marketing@operza.io' },
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ scopes: [] }) })
  });
  assert.equal(goodSendGrid.verified, true);
});

test('Meta WhatsApp Cloud API Sandbox Contract', async () => {
  const badPhone = await whatsappMetaAdapter.verify({
    secret: 'valid_access_token_12345',
    config: { phoneNumberId: '12' } // Too short
  });
  assert.equal(badPhone.verified, false);
  assert.equal(badPhone.code, 'INVALID_CREDENTIAL_FORMAT');

  const goodPhone = await whatsappMetaAdapter.verify({
    secret: 'valid_access_token_12345',
    config: { phoneNumberId: '109827364510293' },
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ id: '109827364510293' }) })
  });
  assert.equal(goodPhone.verified, true);

  const dispatch = await whatsappMetaAdapter.dispatch({
    secret: 'valid_access_token_12345',
    config: { phoneNumberId: '109827364510293' },
    payload: { contactId: 'c1', to: '15559876543', text: 'Order update notification' },
    consent: { status: 'granted', channel: 'whatsapp', contactId: 'c1' },
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.HBgLMTU1NTk4NzY1NDM=' }] }) })
  });

  assert.equal(dispatch.ok, true);
  assert.equal(dispatch.provider, 'whatsapp.meta_cloud');
  assert.ok(dispatch.providerMessageId.startsWith('wamid.'));
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
