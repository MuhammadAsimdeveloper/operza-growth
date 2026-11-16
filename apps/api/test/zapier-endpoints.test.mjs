import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeWebhookUrl, getZapierSamples, dispatchZapierEvent } from '../zapier-router.mjs';
import { authorizeZapierRequest } from '../zapier-authz.mjs';

test('isSafeWebhookUrl rejects insecure and private SSRF target URLs', () => {
  assert.equal(isSafeWebhookUrl('http://insecure.test/hook'), false);
  assert.equal(isSafeWebhookUrl('https://localhost:8080/hook'), false);
  assert.equal(isSafeWebhookUrl('https://127.0.0.1:4000/hook'), false);
  assert.equal(isSafeWebhookUrl('https://169.254.169.254/latest/meta-data'), false);
  assert.equal(isSafeWebhookUrl('https://10.0.0.5/api'), false);
  assert.equal(isSafeWebhookUrl('https://192.168.1.1/hook'), false);
  assert.equal(isSafeWebhookUrl('https://hooks.zapier.com/hooks/catch/123/abc/'), true);
  assert.equal(isSafeWebhookUrl('https://api.external-saas.com/webhooks/incoming'), true);
});

test('getZapierSamples returns canonical samples for field mapping', () => {
  const samples = getZapierSamples('contact.created', {
    contacts: [{ id: 'con_1', firstName: 'Alice', lastName: 'Walker', email: 'alice@test.io' }]
  });
  assert.ok(Array.isArray(samples));
  assert.equal(samples[0].email, 'alice@test.io');
  assert.equal(getZapierSamples('opportunity.stage_changed')[0].stage, 'Proposal Sent');
  assert.equal(getZapierSamples('payment.received')[0].status, 'paid');
});

test('dispatchZapierEvent signs outbound payload with HMAC-SHA256', async () => {
  const state = {
    zapierHookSubscriptions: [{
      id: 'zhk_test_1', agencyId: 'agency_test_1', locationId: 'loc_test_1',
      event: 'contact.created', targetUrl: 'https://hooks.zapier.com/hooks/catch/999/test/',
      signingSecret: 'super-secret-key-007', status: 'active', consecutiveFailures: 0
    }],
    zapierHookDeliveries: []
  };
  let receivedUrl = '';
  let receivedHeaders = {};
  let receivedBody = null;
  const mockFetch = async (url, options) => {
    receivedUrl = url;
    receivedHeaders = options.headers;
    receivedBody = JSON.parse(options.body);
    return { ok: true, status: 200, text: async () => '{"received": true}' };
  };
  const results = await dispatchZapierEvent({
    agencyId: 'agency_test_1', locationId: 'loc_test_1', event: 'contact.created',
    data: { contactId: 'con_100', email: 'neo@matrix.test' }, state, fetchFn: mockFetch
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].delivered, true);
  assert.equal(receivedUrl, 'https://hooks.zapier.com/hooks/catch/999/test/');
  assert.ok(receivedHeaders['X-Operza-Signature'].includes('v1='));
  assert.equal(receivedHeaders['X-Operza-Event'], 'contact.created');
  assert.equal(receivedBody.data.email, 'neo@matrix.test');
  assert.equal(state.zapierHookDeliveries.length, 1);
});

test('Zapier authorization denies write actions when API key only has read scope', () => {
  const result = authorizeZapierRequest({
    method: 'POST',
    pathname: '/api/v1/zapier/actions/create_contact',
    actor: { isApiKey: true, apiKey: { scopes: ['contacts:read'] } }
  });
  assert.equal(result.allowed, false);
  assert.equal(result.requiredScope, 'contacts:write');
});
