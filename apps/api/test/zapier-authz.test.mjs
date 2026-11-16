import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeZapierRequest, getZapierRequiredScope } from '../zapier-authz.mjs';

const actor = scopes => ({ isApiKey: true, apiKey: { scopes } });

test('Zapier route scope lookup distinguishes read and write operations', () => {
  assert.equal(getZapierRequiredScope('GET', '/api/v1/zapier/polls/contact.created'), 'contacts:read');
  assert.equal(getZapierRequiredScope('POST', '/api/v1/zapier/actions/create_contact'), 'contacts:write');
  assert.equal(getZapierRequiredScope('POST', '/api/v1/zapier/actions/trigger_workflow'), 'workflows:execute');
  assert.equal(getZapierRequiredScope('DELETE', '/api/v1/zapier/hooks/unsubscribe/123'), 'webhooks:manage');
  assert.equal(getZapierRequiredScope('GET', '/api/v1/zapier/polls/payment.received'), 'payments:read');
  assert.equal(getZapierRequiredScope('GET', '/api/v1/zapier/polls/invoice.paid'), 'payments:read');
  assert.equal(getZapierRequiredScope('GET', '/api/v1/zapier/polls/notification.created'), 'notifications:read');
  assert.equal(getZapierRequiredScope('GET', '/api/v1/zapier/polls/workflow.completed'), 'workflows:read');
  assert.equal(getZapierRequiredScope('GET', '/api/v1/zapier/samples/tag.added'), 'contacts:read');
});

test('Zapier API key is denied when its stored scopes do not grant the requested action', () => {
  const result = authorizeZapierRequest({
    method: 'POST',
    pathname: '/api/v1/zapier/actions/create_contact',
    actor: actor(['contacts:read'])
  });
  assert.equal(result.allowed, false);
  assert.equal(result.requiredScope, 'contacts:write');
});

test('Zapier API key is allowed only for explicitly granted scopes', () => {
  const result = authorizeZapierRequest({
    method: 'POST',
    pathname: '/api/v1/zapier/actions/create_contact',
    actor: actor(['contacts:write'])
  });
  assert.equal(result.allowed, true);
});

test('legacy workflow trigger scope remains narrowly compatible', () => {
  const result = authorizeZapierRequest({
    method: 'POST',
    pathname: '/api/v1/zapier/actions/trigger_workflow',
    actor: actor(['workflows:trigger'])
  });
  assert.equal(result.allowed, true);
});

test('metadata and cookie-session routes do not require developer-key scopes', () => {
  assert.equal(authorizeZapierRequest({
    method: 'GET',
    pathname: '/api/v1/zapier/auth/me',
    actor: actor([])
  }).allowed, true);
  assert.equal(authorizeZapierRequest({
    method: 'GET',
    pathname: '/api/v1/zapier/hooks',
    actor: { isApiKey: false }
  }).allowed, true);
});

test('API keys fail closed for unknown or unscoped Zapier routes', () => {
  const result = authorizeZapierRequest({
    method: 'POST',
    pathname: '/api/v1/zapier/admin/reset-everything',
    actor: actor(['contacts:read', 'contacts:write', 'webhooks:manage'])
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'UNKNOWN_OR_UNSCOPED_ZAPIER_ROUTE');
});

test('API key payment polling requires the explicit payments:read grant', () => {
  const denied = authorizeZapierRequest({
    method: 'GET',
    pathname: '/api/v1/zapier/polls/payment.received',
    actor: actor(['contacts:read'])
  });
  assert.equal(denied.allowed, false);
  const allowed = authorizeZapierRequest({
    method: 'GET',
    pathname: '/api/v1/zapier/polls/payment.received',
    actor: actor(['payments:read'])
  });
  assert.equal(allowed.allowed, true);
});
