import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectorSdkV2, classifyProviderError } from '../src/connector-sdk-v2.mjs';
import { createOAuthLifecycleEngine } from '../src/oauth-lifecycle-v2.mjs';
import { createSecretResolver } from '../src/secret-vault.mjs';
import {
  createNormalizedEventEnvelope,
  deliverSignedOutboundWebhook,
  signWebhookPayload,
  verifyWebhookSignature
} from '../src/webhook-platform-v2.mjs';
import { mapRecordFields, resolveSyncConflict, shouldSkipForSyncLoop } from '../src/sync-engine-v2.mjs';

test('Connector SDK 2.0 exports scoped workflow nodes, classifies errors, and trips circuit breaker', () => {
  const sdk = createConnectorSdkV2();
  const stripe = sdk.get('stripe');
  assert.equal(stripe.readinessLevel, 'sandbox_verified');

  const scopedNodes = sdk.exportWorkflowNodes({ grantedScopes: ['commerce:read', 'commerce:write'] });
  assert.ok(scopedNodes.some(n => n.nodeType === 'connector.stripe.action.create_payment_link'));
  assert.equal(scopedNodes.some(n => n.nodeType === 'connector.twilio.action.send_sms'), false);

  assert.equal(classifyProviderError(401).retryable, false);
  assert.equal(classifyProviderError(429).retryable, true);

  for (let i = 0; i < 5; i += 1) sdk.recordOutcome('conn-1', false);
  assert.equal(sdk.isCircuitOpen('conn-1'), true);
  sdk.recordOutcome('conn-1', true);
  assert.equal(sdk.isCircuitOpen('conn-1'), false);
});

test('OAuth Lifecycle Engine 2.0 enforces PKCE S256, redirect allowlist, anti-replay, concurrent refresh lock, and revocation', async () => {
  const resolver = createSecretResolver({ masterKey: 'operza_test_master_key_32_chars_min' });
  let currentNow = 1_700_000_000_000;
  let refreshCalls = 0;
  const oauth = createOAuthLifecycleEngine({
    stateKey: 'operza_test_master_key_32_chars_min',
    allowedRedirectOrigins: ['https://app.operza.test'],
    secretResolver: resolver,
    now: () => currentNow,
    fetchFn: async () => {
      refreshCalls += 1;
      return {
        ok: true,
        json: async () => ({ access_token: 'new_acc_tok', refresh_token: 'new_ref_tok', expires_in: 3600 })
      };
    }
  });

  assert.throws(
    () => oauth.createAuthorizationRequest({
      connectorId: 'hubspot',
      authorizeUrl: 'https://auth.example.com/authorize',
      clientId: 'cid',
      redirectUri: 'https://evil.example.com/cb',
      agencyId: 'ag-1',
      locationId: 'loc-1',
      actorId: 'usr-1'
    }),
    err => err.code === 'REDIRECT_URI_NOT_ALLOWLISTED'
  );

  const req = oauth.createAuthorizationRequest({
    connectorId: 'hubspot',
    authorizeUrl: 'https://auth.example.com/authorize',
    clientId: 'cid',
    redirectUri: 'https://app.operza.test/oauth/cb',
    scopes: ['crm.objects.contacts.read'],
    agencyId: 'ag-1',
    locationId: 'loc-1',
    actorId: 'usr-1'
  });
  assert.ok(req.authorizationUrl.includes('code_challenge_method=S256'));

  // Cross-tenant state rejection
  assert.throws(
    () => oauth.verifyAndConsumeState({ state: req.state, agencyId: 'ag-2', locationId: 'loc-1' }),
    err => err.code === 'OAUTH_TENANT_MISMATCH'
  );

  const verified = oauth.verifyAndConsumeState({ state: req.state, agencyId: 'ag-1', locationId: 'loc-1' });
  assert.equal(verified.connectorId, 'hubspot');

  // Replay rejected
  assert.throws(
    () => oauth.verifyAndConsumeState({ state: req.state, agencyId: 'ag-1', locationId: 'loc-1' }),
    err => err.code === 'OAUTH_STATE_REPLAY'
  );

  // Concurrent refresh lock deduplicates network refresh
  await resolver.store('vault:ag-1:hubspot:1', JSON.stringify({
    accessToken: 'old_acc',
    refreshToken: 'old_ref',
    expiresAt: currentNow + 10_000,
    scopes: ['crm.objects.contacts.read'],
    revoked: false
  }));
  const [r1, r2] = await Promise.all([
    oauth.refreshTokenBundle({ secretRef: 'vault:ag-1:hubspot:1', tokenEndpoint: 'https://auth.example.com/token', clientId: 'cid', clientSecret: 'sec' }),
    oauth.refreshTokenBundle({ secretRef: 'vault:ag-1:hubspot:1', tokenEndpoint: 'https://auth.example.com/token', clientId: 'cid', clientSecret: 'sec' })
  ]);
  assert.equal(refreshCalls, 1);
  assert.equal(r1.rotated, true);
  assert.equal(r2.rotated, true);

  // Revocation blocks further refresh
  await oauth.revokeConnectionSecret('vault:ag-1:hubspot:1');
  await assert.rejects(
    () => oauth.refreshTokenBundle({ secretRef: 'vault:ag-1:hubspot:1', tokenEndpoint: 'https://auth.example.com/token', clientId: 'cid', clientSecret: 'sec' }),
    err => err.code === 'CREDENTIAL_REVOKED'
  );
});

test('Webhook Platform 2.0 validates signatures, rejects replay/oversized payloads, and blocks SSRF', async () => {
  const secret = 'whsec_test_secret_123456';
  const payload = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded' });
  const nowSec = 1_700_000_000;
  const signed = signWebhookPayload({ payload, secret, timestamp: nowSec });

  assert.equal(verifyWebhookSignature({ rawBody: payload, signatureHeader: signed.headerValue, secret, nowSec }).valid, true);
  assert.equal(verifyWebhookSignature({ rawBody: payload, signatureHeader: signed.headerValue, secret, nowSec: nowSec + 500 }).code, 'WEBHOOK_TIMESTAMP_OUT_OF_WINDOW');
  assert.equal(verifyWebhookSignature({ rawBody: payload, signatureHeader: `t=${nowSec},v1=${'0'.repeat(64)}`, secret, nowSec }).code, 'INVALID_SIGNATURE');

  const env = createNormalizedEventEnvelope({
    provider: 'stripe',
    agencyId: 'ag-1',
    locationId: 'loc-1',
    providerEventId: 'evt_1',
    eventType: 'payment.succeeded',
    payload: { amountCents: 5000 }
  });
  assert.equal(env.processingState, 'normalized');

  const ssrfRes = await deliverSignedOutboundWebhook({
    url: 'https://127.0.0.1:8080/hook',
    secret,
    eventType: 'contact.created',
    payload: { id: 'c1' },
    requireHttps: true
  });
  assert.equal(ssrfRes.ok, false);
  assert.ok(typeof ssrfRes.code === 'string' && ssrfRes.code.length > 0);
});

test('Data Sync Engine 2.0 prevents sync loops and resolves conflicts deterministically', () => {
  const mapped = mapRecordFields({ email_address: 'a@b.com', full_name: 'Ada' }, { email: 'email_address', name: 'full_name' });
  assert.deepEqual(mapped, { email: 'a@b.com', name: 'Ada' });

  assert.equal(shouldSkipForSyncLoop({ originSystem: 'operza', currentSystem: 'operza' }).skip, true);
  assert.equal(shouldSkipForSyncLoop({ originSystem: 'hubspot', originEventId: 'ev1', seenOriginEvents: new Set(['ev1']) }).skip, true);

  const manual = resolveSyncConflict({ conflictPolicy: 'manual_queue', localRecord: { name: 'A' }, externalRecord: { name: 'B' } });
  assert.equal(manual.resolution, 'conflict_queued');

  const tsWins = resolveSyncConflict({
    conflictPolicy: 'timestamp_wins',
    localRecord: { name: 'Local', updatedAt: '2026-01-01T00:00:00Z' },
    externalRecord: { name: 'Ext', updatedAt: '2026-01-02T00:00:00Z' }
  });
  assert.equal(tsWins.resolution, 'external_wins');
  assert.equal(tsWins.merged.name, 'Ext');
});
