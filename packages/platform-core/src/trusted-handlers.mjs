import crypto from 'node:crypto';
import https from 'node:https';
import net from 'node:net';
import { PermanentJobError } from './durable-worker.mjs';
import { assertSafeTargetUrl, prePinDnsLookup } from './ssrf-defense.mjs';

function sha256(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

/**
 * HTTPS-only webhook request using a DNS-prevalidated and pinned destination IP.
 * Redirects are not followed; the caller must provide the final public HTTPS URL.
 */
async function postPinnedHttps(rawUrl, options = {}) {
  const validated = assertSafeTargetUrl(rawUrl);
  const pinnedAddress = await prePinDnsLookup(validated.hostname);
  const url = new URL(validated.url);
  const family = net.isIP(pinnedAddress);

  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      hostname: validated.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: options.method || 'POST',
      headers: options.headers || {},
      servername: validated.hostname,
      rejectUnauthorized: true,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions?.all) callback(null, [{ address: pinnedAddress, family }]);
        else callback(null, pinnedAddress, family);
      }
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size <= 16_384) chunks.push(chunk);
      });
      response.on('end', () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode || 0,
          text: async () => Buffer.concat(chunks).toString('utf8')
        });
      });
    });

    request.setTimeout(8_000, () => request.destroy(Object.assign(new Error('Webhook delivery timed out'), { code: 'WEBHOOK_TIMEOUT' })));
    request.on('error', reject);
    if (options.signal?.aborted) {
      request.destroy(Object.assign(new Error('Webhook delivery aborted'), { code: 'WEBHOOK_ABORTED' }));
      return;
    }
    options.signal?.addEventListener('abort', () => {
      request.destroy(Object.assign(new Error('Webhook delivery aborted'), { code: 'WEBHOOK_ABORTED' }));
    }, { once: true });
    if (options.body) request.write(options.body);
    request.end();
  });
}

/**
 * Explicit trusted worker handlers. Unsupported business events fail closed
 * instead of being acknowledged as completed without a real business action.
 */
export function createTrustedWorkerHandlers({ fetchFn = postPinnedHttps } = {}) {
  return {
    'workflow.trigger.enqueued': async () => {
      throw new PermanentJobError(
        'Workflow trigger jobs require the API workflow runtime handler, which is not connected to this worker',
        'WORKFLOW_RUNTIME_NOT_CONFIGURED'
      );
    },

    'workflow.step.resume': async () => {
      throw new PermanentJobError(
        'Approval resume jobs require persisted execution-state integration, which is not connected to this worker',
        'WORKFLOW_RESUME_NOT_CONFIGURED'
      );
    },

    'workflow.action.execute': async (payload, { job, workerId, lease }) => {
      if (!payload?.tenantId || !payload?.actionId) {
        throw new PermanentJobError('Payload missing required actionId or tenantId', 'INVALID_ACTION_PAYLOAD');
      }
      if (lease?.lost) return { status: 'lease_lost' };

      const isDryRun = payload.dryRun !== false;
      const actionReceipt = sha256({
        tenantId: payload.tenantId,
        actionId: payload.actionId,
        input: payload.input || {},
        idempotencyKey: job.idempotencyKey
      });

      if (!isDryRun) {
        throw new PermanentJobError(
          'Live connector actions require a configured provider executor; no external side effect was performed',
          'PROVIDER_EXECUTOR_NOT_CONFIGURED'
        );
      }
      return {
        status: 'simulated',
        actionId: payload.actionId,
        actionReceipt,
        sideEffectsDisabled: true,
        workerId,
        executedAt: new Date().toISOString()
      };
    },

    'crm.lead.qualified': async () => {
      throw new PermanentJobError(
        'Lead qualification handler is not connected to a persisted CRM scoring service',
        'CRM_QUALIFICATION_NOT_CONFIGURED'
      );
    },

    'audit.event.record': async () => {
      throw new PermanentJobError(
        'Audit event worker handler is not connected to the immutable audit repository',
        'AUDIT_REPOSITORY_NOT_CONFIGURED'
      );
    },

    'zapier.webhook.deliver': async (payload, { job, workerId, lease, signal }) => {
      if (!payload?.tenantId || !payload?.locationId || !payload?.subscriptionId ||
          typeof payload.event !== 'string' || typeof payload.signatureHeader !== 'string' ||
          !payload.body || typeof payload.body !== 'object' || Array.isArray(payload.body)) {
        throw new PermanentJobError('Zapier delivery job payload is incomplete', 'INVALID_ZAPIER_DELIVERY_PAYLOAD');
      }
      if (lease?.lost) return { status: 'lease_lost' };

      try {
        assertSafeTargetUrl(payload.targetUrl);
      } catch (error) {
        throw new PermanentJobError('Zapier target URL failed SSRF validation', error?.code || 'SSRF_TARGET_BLOCKED');
      }

      const response = await fetchFn(payload.targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Operza-Signature': payload.signatureHeader,
          'X-Operza-Event': payload.event,
          'X-Operza-Delivery-Id': payload.body.deliveryId || job.id
        },
        body: JSON.stringify(payload.body),
        signal: signal || AbortSignal.timeout(8_000)
      });
      const httpStatus = Number(response?.status || 0);
      if (response?.ok !== true) {
        if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500 || httpStatus === 0) {
          throw Object.assign(new Error('Zapier endpoint returned a retryable response'), {
            code: 'ZAPIER_WEBHOOK_RETRYABLE'
          });
        }
        throw new PermanentJobError('Zapier endpoint rejected the webhook delivery', 'ZAPIER_WEBHOOK_REJECTED');
      }

      return {
        status: 'delivered',
        event: payload.event,
        subscriptionId: payload.subscriptionId,
        httpStatus,
        deliveryId: payload.body.deliveryId || job.id,
        idempotencyKey: job.idempotencyKey,
        workerId,
        deliveredAt: new Date().toISOString()
      };
    }
  };
}

export const handlers = createTrustedWorkerHandlers();
export const trustedWorkerHandlers = handlers;
export default { handlers };
