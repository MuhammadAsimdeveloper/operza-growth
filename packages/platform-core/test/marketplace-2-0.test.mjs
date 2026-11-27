import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionAppStatus,
  checkUpgradeScopeEscalation,
  compareSemver,
  validateAppManifest
} from '../src/marketplace-2-0.mjs';

test('Manifest Validator rejects executable code, unsafe URLs, unknown scopes, and invalid pricing', () => {
  const valid = validateAppManifest({
    slug: 'acme-crm-sync',
    name: 'Acme CRM Sync',
    appType: 'external_connector',
    version: '1.2.0',
    pricingModel: 'subscription',
    priceCents: 2900,
    documentationUrl: 'https://docs.example.com/acme',
    requestedScopes: ['contacts:read', 'contacts:write']
  });
  assert.equal(valid.valid, true);

  const badCode = validateAppManifest({
    slug: 'bad-app',
    name: 'Bad App',
    appType: 'workflow_extension',
    version: '1.0.0',
    hook: 'eval("process.exit(1)")'
  });
  assert.equal(badCode.valid, false);
  assert.ok(badCode.errors.some(e => e.code === 'EXECUTABLE_CODE_FORBIDDEN'));

  const badScope = validateAppManifest({
    slug: 'scope-app',
    name: 'Scope App',
    appType: 'ai_tool',
    version: '1.0.0',
    requestedScopes: ['db:superuser']
  });
  assert.equal(badScope.valid, false);
  assert.ok(badScope.errors.some(e => e.code === 'UNSUPPORTED_SCOPE'));

  const badUrl = validateAppManifest({
    slug: 'http-app',
    name: 'Http App',
    appType: 'workflow_template',
    version: '1.0.0',
    documentationUrl: 'http://insecure.example.com'
  });
  assert.equal(badUrl.valid, false);
  assert.ok(badUrl.errors.some(e => e.code === 'UNSAFE_URL'));
});

test('Semver comparison, upgrade scope escalation, and lifecycle state transitions work deterministically', () => {
  assert.equal(compareSemver('1.2.0', '1.1.9'), 1);
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('1.0.0', '2.0.0'), -1);

  const esc = checkUpgradeScopeEscalation({
    currentGrantedScopes: ['contacts:read'],
    nextRequestedScopes: ['contacts:read', 'communications:send']
  });
  assert.equal(esc.requiresRenewedConsent, true);
  assert.deepEqual(esc.newlyRequestedScopes, ['communications:send']);

  assert.equal(canTransitionAppStatus('draft', 'submitted'), true);
  assert.equal(canTransitionAppStatus('draft', 'published'), false);
  assert.equal(canTransitionAppStatus('under_review', 'approved'), true);
  assert.equal(canTransitionAppStatus('published', 'suspended'), true);
});
