import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeZapierRequest, getZapierRequiredScope } from '../zapier-authz.mjs';

const actor = scopes => ({ isApiKey: true, apiKey: { scopes } });

test('Zapier route scope lookup distinguishes read and write operations', () => {
  assert.equal(getZapierRequiredScope('GET', '/api/v1/zapier/polls/contact.created'), 'contacts:read');
  assert.equal(getZapierRequiredScope('POST', '/api/v1/zapier/actions/create_contact'), 'contacts:write');
  assert.equal(getZapierRequiredScope('POST', '/api/v1/zapier/actions/trigger_workflow'), 'workflows:execute');
  assert.equal(getZapierRequiredScope('DELETE', '/api/v1/zapier/hooks/unsubscribe/123'), 'webhooks:manage');
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
