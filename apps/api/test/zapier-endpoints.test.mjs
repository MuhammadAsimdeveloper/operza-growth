import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeWebhookUrl, getZapierSamples, dispatchZapierEvent, getZapierRequiredScopes, isZapierScopeAuthorized } from '../zapier-router.mjs';

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
  const contactSamples = getZapierSamples('contact.created', {
    contacts: [{ id: 'con_1', firstName: 'Alice', lastName: 'Walker', email: 'alice@test.io' }]
  });
  assert.ok(Array.isArray(contactSamples));
  assert.equal(contactSamples[0].email, 'alice@test.io');

  const oppSamples = getZapierSamples('opportunity.stage_changed');
  assert.ok(Array.isArray(oppSamples));
  assert.equal(oppSamples[0].stage, 'Proposal Sent');

  const paymentSamples = getZapierSamples('payment.received');
  assert.ok(Array.isArray(paymentSamples));
  assert.equal(paymentSamples[0].status, 'paid');
});

test('dispatchZapierEvent signs outbound payload with HMAC-SHA256', async () => {
  const state = {
    zapierHookSubscriptions: [
      {
        id: 'zhk_test_1',
        agencyId: 'agency_test_1',
        locationId: 'loc_test_1',
        event: 'contact.created',
        targetUrl: 'https://hooks.zapier.com/hooks/catch/999/test/',
        signingSecret: 'super-secret-key-007',
        status: 'active',
        consecutiveFailures: 0
      }
    ],
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
    agencyId: 'agency_test_1',
    locationId: 'loc_test_1',
    event: 'contact.created',
    data: { contactId: 'con_100', email: 'neo@matrix.test' },
    state,
    fetchFn: mockFetch
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].delivered, true);
  assert.equal(receivedUrl, 'https://hooks.zapier.com/hooks/catch/999/test/');
  assert.ok(receivedHeaders['X-Operza-Signature'].includes('v1='));
  assert.equal(receivedHeaders['X-Operza-Event'], 'contact.created');
  assert.equal(receivedBody.data.email, 'neo@matrix.test');
  assert.equal(state.zapierHookDeliveries.length, 1);
});


test('Zapier routes map to least-privilege resource scopes', () => {
  assert.deepEqual(getZapierRequiredScopes('POST', '/api/v1/zapier/actions/create_contact'), ['contacts:write']);
  assert.deepEqual(getZapierRequiredScopes('GET', '/api/v1/zapier/hooks'), ['webhooks:read']);
  assert.deepEqual(getZapierRequiredScopes('POST', '/api/v1/zapier/hooks/subscribe'), ['webhooks:manage']);
  assert.deepEqual(getZapierRequiredScopes('POST', '/api/v1/zapier/actions/trigger_workflow'), ['workflows:execute']);
  assert.deepEqual(getZapierRequiredScopes('GET', '/api/v1/zapier/polls/contact.created'), ['contacts:read']);
});

test('Zapier API keys are restricted to their explicit scopes and legacy aliases', () => {
  assert.equal(isZapierScopeAuthorized({ isApiKey: true, apiKey: { scopes: ['contacts:read'] } }, ['contacts:read']), true);
  assert.equal(isZapierScopeAuthorized({ isApiKey: true, apiKey: { scopes: ['contacts:read'] } }, ['contacts:write']), false);
  assert.equal(isZapierScopeAuthorized({ isApiKey: true, apiKey: { scopes: ['workflows:trigger'] } }, ['workflows:execute']), true);
  assert.equal(isZapierScopeAuthorized({ isApiKey: true, apiKey: { scopes: [] } }, ['contacts:read']), false);
  assert.equal(isZapierScopeAuthorized({ isApiKey: false }, ['contacts:write']), true);
});
