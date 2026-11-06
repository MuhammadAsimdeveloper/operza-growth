import test from 'node:test';
import assert from 'node:assert/strict';
import { executeStep } from '../src/engine.mjs';

test('zapier node simulates in dry-run mode without external side effects', async () => {
  const node = {
    id: 'node-zap-1',
    type: 'zapier',
    config: {
      webhookUrl: 'https://hooks.zapier.com/hooks/catch/999/abc/',
      eventName: 'lead.qualified',
      payload: { leadTier: 'enterprise', budget: 100000 }
    }
  };

  const res = await executeStep({
    node,
    execution: { mode: 'dry_run', id: 'exec-dry-1', agencyId: 'agency-1' },
    triggerContext: { contact: { email: 'ceo@enterprise.test' } }
  });

  assert.equal(res.status, 'simulated');
  assert.equal(res.result.sideEffectsDisabled, true);
  assert.equal(res.result.mode, 'dry_run');
});

test('zapier node rejects invalid non-HTTPS Zapier hook in live mode', async () => {
  const node = {
    id: 'node-zap-2',
    type: 'zapier',
    config: {
      webhookUrl: 'http://malicious-site.test/exploit'
    }
  };

  const res = await executeStep({
    node,
    execution: { mode: 'live', id: 'exec-live-1', agencyId: 'agency-1', workflowId: 'wf-1' },
    triggerContext: {}
  });

  assert.equal(res.status, 'failed');
  assert.equal(res.errorCode, 'INVALID_ZAPIER_URL');
});

test('zapier node signs payload and posts in live mode', async () => {
  const originalFetch = globalThis.fetch;
  let postedUrl = null;
  let postedHeaders = null;
  let postedBody = null;

  globalThis.fetch = async (url, options) => {
    postedUrl = url;
    postedHeaders = options.headers;
    postedBody = JSON.parse(options.body);
    return { ok: true, status: 200 };
  };

  try {
    const node = {
      id: 'node-zap-3',
      type: 'zapier',
      config: {
        webhookUrl: 'https://hooks.zapier.com/hooks/catch/123/xyz/',
        eventName: 'contact.created',
        signingSecret: 'test-secret-key-123'
      }
    };

    const res = await executeStep({
      node,
      execution: { mode: 'live', id: 'exec-live-3', agencyId: 'agency-1', workflowId: 'wf-3' },
      triggerContext: { contact: { email: 'sarah@skynet.test' } }
    });

    assert.equal(res.status, 'completed');
    assert.equal(res.result.zapierStatus, 'dispatched');
    assert.equal(postedUrl, 'https://hooks.zapier.com/hooks/catch/123/xyz/');
    assert.ok(postedHeaders['X-Operza-Signature'].startsWith('sha256='));
    assert.equal(postedHeaders['X-Operza-Execution-Id'], 'exec-live-3');
    assert.equal(postedBody.event, 'contact.created');
    assert.equal(postedBody.data.contact.email, 'sarah@skynet.test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
