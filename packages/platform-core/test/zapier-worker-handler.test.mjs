import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrustedWorkerHandlers } from '../src/trusted-handlers.mjs';

const basePayload = {
  tenantId: 'tenant_001',
  locationId: 'location_001',
  subscriptionId: 'subscription_001',
  event: 'contact.created',
  targetUrl: 'https://hooks.zapier.com/hooks/catch/123/abc/',
  body: { event: 'contact.created', data: { contactId: 'contact_001' } },
  signatureHeader: 't=1763200000,v1=abcdef0123456789'
};

test('Zapier webhook worker delivers the signed payload and returns the actual provider response', async () => {
  let request;
  const handlers = createTrustedWorkerHandlers({
    fetchFn: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, text: async () => 'accepted' };
    }
  });
  const result = await handlers['zapier.webhook.deliver'](basePayload, {
    job: { id: 'job_001', idempotencyKey: 'idem_zapier_001', attempts: 1 },
    workerId: 'worker_001',
    lease: { lost: false }
  });
  assert.equal(request.url, basePayload.targetUrl);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['X-Operza-Signature'], basePayload.signatureHeader);
  assert.deepEqual(JSON.parse(request.options.body), basePayload.body);
  assert.equal(result.status, 'delivered');
  assert.equal(result.httpStatus, 200);
});

test('Zapier webhook worker fails closed on unsafe targets', async () => {
  const handlers = createTrustedWorkerHandlers({ fetchFn: async () => { throw new Error('must not fetch'); } });
  await assert.rejects(
    handlers['zapier.webhook.deliver']({ ...basePayload, targetUrl: 'https://127.0.0.1/internal' }, {
      job: { id: 'job_002', idempotencyKey: 'idem_zapier_002' },
      workerId: 'worker_001',
      lease: { lost: false }
    }),
    { code: 'SSRF_PRIVATE_IP_TARGET' }
  );
});

test('Zapier webhook worker retries transient failures and stops on permanent client errors', async () => {
  const retryable = createTrustedWorkerHandlers({
    fetchFn: async () => ({ ok: false, status: 503, text: async () => 'temporarily unavailable' })
  });
  await assert.rejects(
    retryable['zapier.webhook.deliver'](basePayload, {
      job: { id: 'job_003', idempotencyKey: 'idem_zapier_003' },
      workerId: 'worker_001',
      lease: { lost: false }
    }),
    { code: 'ZAPIER_WEBHOOK_RETRYABLE' }
  );

  const permanent = createTrustedWorkerHandlers({
    fetchFn: async () => ({ ok: false, status: 404, text: async () => 'not found' })
  });
  await assert.rejects(
    permanent['zapier.webhook.deliver'](basePayload, {
      job: { id: 'job_004', idempotencyKey: 'idem_zapier_004' },
      workerId: 'worker_001',
      lease: { lost: false }
    }),
    { code: 'ZAPIER_WEBHOOK_REJECTED' }
  );
});
