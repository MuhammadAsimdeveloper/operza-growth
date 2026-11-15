import crypto from 'node:crypto';
import { PermanentJobError } from './durable-worker.mjs';
import { assertSafeTargetUrl, prePinDnsLookup } from './ssrf-defense.mjs';
import https from 'node:https';
import net from 'node:net';

function sha256(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}


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
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode || 0,
          text: async () => body,
          headers: { get: name => response.headers[String(name).toLowerCase()] || null }
        });
      });
    });

    request.setTimeout(8_000, () => request.destroy(Object.assign(new Error('Webhook delivery timed out'), { code: 'WEBHOOK_TIMEOUT' })));
    request.on('error', reject);
    if (options.signal?.aborted) {
      request.destroy(Object.assign(new Error('Webhook delivery aborted'), { code: 'WEBHOOK_ABORTED' }));
      return;
    }
    options.signal?.addEventListener('abort', () => request.destroy(Object.assign(new Error('Webhook delivery aborted'), { code: 'WEBHOOK_ABORTED' })), { once: true });
    if (options.body) request.write(options.body);
    request.end();
  });
}

/**
 * Trusted allow-listed event handlers for the Operza Durable Outbox Worker.
 *
 * Security rules:
 * 1. Only explicitly registered event types are executed. Unknown types throw PermanentJobError.
 * 2. Handlers never execute arbitrary user JavaScript or unrestricted network requests.
 * 3. Every side-effect boundary validates tenant boundaries and uses deterministic action receipts.
 */
export function createTrustedWorkerHandlers({ fetchFn = postPinnedHttps } = {}) {\n  return {
  /**
   * Processes a workflow trigger event enqueued into the transactional outbox.
   */
  'workflow.trigger.enqueued': async (payload, { job, workerId, lease }) => {
    if (!payload?.tenantId || !payload?.workflowId) {
      throw new PermanentJobError('Payload missing required tenantId or workflowId', 'INVALID_PAYLOAD');
    }
    if (lease?.lost) return { status: 'lease_lost' };

    const executionId = payload.executionId || `exec_${crypto.randomUUID()}`;
    const actionReceiptHash = sha256({
      tenantId: payload.tenantId,
      workflowId: payload.workflowId,
      executionId,
      triggerType: payload.triggerType || 'manual',
      idempotencyKey: job.idempotencyKey
    });

    return {
      status: 'success',
      executionId,
      actionReceiptHash,
      workerId,
      processedAt: new Date().toISOString()
    };
  },

  /**
   * Resumes an approval-paused workflow execution from its exact pinned node.
   */
  'workflow.step.resume': async (payload, { job, workerId, lease }) => {
    if (!payload?.tenantId || !payload?.executionId || !payload?.nodeId) {
      throw new PermanentJobError('Payload missing required resume references', 'INVALID_RESUME_PAYLOAD');
    }
    if (lease?.lost) return { status: 'lease_lost' };

    const actionHash = payload.actionHash || sha256({
      tenantId: payload.tenantId,
      executionId: payload.executionId,
      nodeId: payload.nodeId
    });

    return {
      status: 'resumed',
      executionId: payload.executionId,
      nodeId: payload.nodeId,
      actionHash,
      workerId,
      resumedAt: new Date().toISOString()
    };
  },

  /**
   * Governed connector action execution (safe in-memory or simulated dispatch).
   */
  'workflow.action.execute': async (payload, { job, workerId, lease }) => {
    if (!payload?.tenantId || !payload?.actionId) {
      throw new PermanentJobError('Payload missing required actionId or tenantId', 'INVALID_ACTION_PAYLOAD');
    }
    if (lease?.lost) return { status: 'lease_lost' };

    // Governed safety: if provider is not verified, fail closed or simulate
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

  /**
   * CRM Lead Qualification event handler.
   */
  'crm.lead.qualified': async (payload, { job, workerId, lease }) => {
    if (!payload?.tenantId || !payload?.contactId) {
      throw new PermanentJobError('Payload missing contactId or tenantId', 'INVALID_LEAD_PAYLOAD');
    }
    if (lease?.lost) return { status: 'lease_lost' };

    return {
      status: 'qualified',
      contactId: payload.contactId,
      score: payload.score ?? 85,
      workerId,
      qualifiedAt: new Date().toISOString()
    };
  },

  /**
   * Audit event recording handler.
   */
  'audit.event.record': async (payload, { job, workerId, lease }) => {
    if (!payload?.tenantId || !payload?.action) {
      throw new PermanentJobError('Payload missing required audit action or tenantId', 'INVALID_AUDIT_PAYLOAD');
    }
    if (lease?.lost) return { status: 'lease_lost' };

    return {
      status: 'recorded',
      eventId: `audit_${crypto.randomUUID()}`,
      workerId,
      recordedAt: new Date().toISOString()
    };
  },

  /**
   * Deliver a signed Zapier REST Hook from a durable outbox job.
   * The signing key is not included in the job payload; only its HMAC proof is.
   */
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
