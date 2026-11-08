import test from 'node:test';
import assert from 'node:assert/strict';
import { executeStep } from '../src/engine.mjs';

const executionBase = {
  id: 'exec_ssrf_123',
  agencyId: 'agency_test_123',
  workflowId: 'wf_test_123',
  actorId: 'actor_test_123',
  allowDirectNetwork: true,
  mode: 'live'
};

test('Workflow Engine SSRF defense: blocks AWS metadata endpoint 169.254.169.254', async () => {
  const result = await executeStep({
    node: {
      id: 'webhook_aws_meta',
      type: 'webhook',
      config: { url: 'https://169.254.169.254/latest/meta-data/' }
    },
    execution: { ...executionBase },
    triggerContext: {}
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'SSRF_PRIVATE_IP_TARGET');
});

test('Workflow Engine SSRF defense: blocks loopback targets 127.0.0.1 and localhost', async () => {
  const resultIp = await executeStep({
    node: {
      id: 'http_loopback',
      type: 'http_request',
      config: { url: 'https://127.0.0.1:4000/internal-secrets', method: 'GET' }
    },
    execution: { ...executionBase },
    triggerContext: {}
  });

  assert.equal(resultIp.status, 'failed');
  assert.equal(resultIp.errorCode, 'SSRF_PRIVATE_IP_TARGET');

  const resultHost = await executeStep({
    node: {
      id: 'http_localhost',
      type: 'http_request',
      config: { url: 'https://localhost:4000/api/keys', method: 'GET' }
    },
    execution: { ...executionBase },
    triggerContext: {}
  });

  assert.equal(resultHost.status, 'failed');
  assert.equal(resultHost.errorCode, 'SSRF_PRIVATE_NETWORK_TARGET');
});

test('Workflow Engine SSRF defense: blocks private network targets in slack_notify', async () => {
  const result = await executeStep({
    node: {
      id: 'slack_internal',
      type: 'slack_notify',
      config: { webhookUrl: 'https://10.0.0.5/slack/hook', message: 'Hello' }
    },
    execution: { ...executionBase },
    triggerContext: {}
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'SSRF_PRIVATE_IP_TARGET');
});

test('Workflow Engine SSRF defense: blocks plain HTTP schemes (strictly requires HTTPS)', async () => {
  const result = await executeStep({
    node: {
      id: 'http_insecure',
      type: 'http_request',
      config: { url: 'http://api.external.com/v1/hook' }
    },
    execution: { ...executionBase },
    triggerContext: {}
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'HTTPS_REQUIRED');
});
