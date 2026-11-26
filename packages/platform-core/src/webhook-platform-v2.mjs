/**
 * ============================================================================
 * Operza Webhook Platform 2.0 — Inbound Verification & Outbound Signed Delivery
 * ============================================================================
 * Enforces HMAC-SHA256 timestamped signatures, replay window protection (300s),
 * payload size limits, normalized event envelopes, and SSRF-safe outbound
 * webhook delivery with redirect:'error'.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { assertSafeTargetUrl } from './ssrf-defense.mjs';

const DEFAULT_MAX_BYTES = 262_144;
const DEFAULT_REPLAY_WINDOW_SEC = 300;

export function signWebhookPayload({ payload, secret, timestamp = Math.floor(Date.now() / 1000) }) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signedContent = `${timestamp}.${raw}`;
  const sig = createHmac('sha256', secret).update(signedContent).digest('hex');
  return {
    timestamp,
    signature: sig,
    headerValue: `t=${timestamp},v1=${sig}`
  };
}

export function verifyWebhookSignature({
  rawBody,
  signatureHeader,
  secret,
  nowSec = Math.floor(Date.now() / 1000),
  replayWindowSec = DEFAULT_REPLAY_WINDOW_SEC,
  maxBytes = DEFAULT_MAX_BYTES
}) {
  if (typeof rawBody !== 'string') {
    return { valid: false, code: 'INVALID_BODY' };
  }
  if (Buffer.byteLength(rawBody, 'utf8') > maxBytes) {
    return { valid: false, code: 'PAYLOAD_TOO_LARGE' };
  }
  if (typeof signatureHeader !== 'string' || !signatureHeader.trim() || typeof secret !== 'string' || !secret) {
    return { valid: false, code: 'MISSING_SIGNATURE' };
  }

  const parts = Object.fromEntries(
    signatureHeader.split(',').map(part => {
      const idx = part.indexOf('=');
      return idx > 0 ? [part.slice(0, idx).trim(), part.slice(idx + 1).trim()] : ['', ''];
    })
  );
  const ts = Number(parts.t);
  const providedSig = parts.v1 || '';
  if (!Number.isFinite(ts) || !/^[a-f0-9]{64}$/i.test(providedSig)) {
    return { valid: false, code: 'MALFORMED_SIGNATURE_HEADER' };
  }
  if (Math.abs(nowSec - ts) > replayWindowSec) {
    return { valid: false, code: 'WEBHOOK_TIMESTAMP_OUT_OF_WINDOW' };
  }

  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const a = Buffer.from(providedSig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, code: 'INVALID_SIGNATURE' };
  }
  return { valid: true, timestamp: ts };
}

export function createNormalizedEventEnvelope({
  provider,
  connectionId = null,
  agencyId,
  locationId,
  providerEventId,
  eventType,
  payload = {},
  occurredAt = new Date().toISOString(),
  correlationId = randomUUID()
}) {
  if (!agencyId || !locationId || !provider || !eventType) {
    throw Object.assign(new TypeError('Normalized event requires trusted tenant, provider, and eventType'), {
      code: 'INVALID_EVENT_ENVELOPE'
    });
  }
  return {
    eventId: randomUUID(),
    eventType,
    provider,
    connectionId,
    agencyId,
    locationId,
    providerEventId: String(providerEventId || randomUUID()),
    occurredAt,
    receivedAt: new Date().toISOString(),
    schemaVersion: 1,
    normalizedPayload: payload,
    processingState: 'normalized',
    correlationId
  };
}

export async function deliverSignedOutboundWebhook({
  url,
  secret,
  eventType,
  payload,
  deliveryId = randomUUID(),
  fetchFn = globalThis.fetch,
  requireHttps = false
}) {
  try {
    await assertSafeTargetUrl(url, { allowHttp: !requireHttps });
  } catch (err) {
    return { ok: false, code: err?.code || 'SSRF_BLOCKED', error: err?.message || 'Unsafe target URL' };
  }
  const body = JSON.stringify({ id: deliveryId, eventType, payload });
  const { headerValue } = signWebhookPayload({ payload: body, secret });
  try {
    const resp = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Operza-Signature': headerValue,
        'X-Operza-Delivery-Id': deliveryId
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });
    return {
      ok: resp.ok,
      httpStatus: resp.status,
      deliveryId,
      code: resp.ok ? 'DELIVERED' : 'DELIVERY_HTTP_ERROR'
    };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      deliveryId,
      code: err?.name === 'TimeoutError' ? 'DELIVERY_TIMEOUT' : 'DELIVERY_NETWORK_ERROR',
      error: err?.message || 'Outbound delivery failed'
    };
  }
}
