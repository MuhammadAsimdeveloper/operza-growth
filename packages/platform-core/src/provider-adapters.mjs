import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { generateDeterministicIdempotencyKey } from './outbox-producer.mjs';

const META_VERSION = process.env.META_GRAPH_API_VERSION || 'v27.0';
const emailRecipients = value => (Array.isArray(value) ? value : [value]).flatMap(item => {
  const email = typeof item === 'string' ? item : item?.email;
  return typeof email === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email.trim()) ? [{ email: email.trim() }] : [];
});
const consentOk = (consent, channel, payload) => consent?.status === 'granted' &&
  consent.channel === channel && consent.contactId && consent.contactId === payload?.contactId &&
  (!payload.purpose || consent.purpose === payload.purpose);
const failure = (code, httpStatus = 0) => ({ ok: false, code, httpStatus: Number(httpStatus) || 0 });
const bearer = secret => ({ Authorization: 'Bearer ' + secret });
const twilioAuth = (sid, token) => ({ Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64') });

async function request(fetchFn, url, options = {}) {
  if (typeof fetchFn !== 'function') throw new Error('fetch unavailable');
  return fetchFn(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10_000) });
}
async function responseJson(res) {
  if (typeof res?.json === 'function') return res.json().catch(() => ({}));
  if (typeof res?.text === 'function') {
    const raw = await res.text().catch(() => '');
    try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  }
  return {};
}
function validEmailPayload(payload) {
  const to = emailRecipients(payload.to || payload.recipient || payload.email);
  const subject = String(payload.subject || '').trim();
  const text = typeof payload.text === 'string' ? payload.text : '';
  const html = typeof payload.html === 'string' ? payload.html : '';
  if (!to.length || to.length > 50) return { code: 'INVALID_RECIPIENTS' };
  if (!subject || subject.length > 255 || /[\r\n]/.test(subject)) return { code: 'INVALID_SUBJECT' };
  if ((!text && !html) || text.length > 100_000 || html.length > 100_000) return { code: 'INVALID_MESSAGE_BODY' };
  return { to, subject, text, html };
}
function makeIdempotencyKey({ tenantId, locationId, actionHash }) {
  if (!tenantId || !locationId || !actionHash) return null;
  return generateDeterministicIdempotencyKey({
    tenantId, locationId, scope: 'provider_dispatch', uniqueEntityId: actionHash
  });
}

export const resendEmailAdapter = Object.freeze({
  id: 'adapter-resend-email-v2', providerKey: 'email.resend', channel: 'email',
  async verify({ secret, config = {}, fetchFn = globalThis.fetch } = {}) {
    if (typeof secret !== 'string' || !/^re_[A-Za-z0-9_-]{8,}$/.test(secret)) return { verified: false, code: 'INVALID_CREDENTIAL_FORMAT' };
    if (config.senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.senderEmail)) return { verified: false, code: 'INVALID_SENDER_EMAIL' };
    try {
      const res = await request(fetchFn, 'https://api.resend.com/domains?limit=1', { method: 'GET', headers: bearer(secret) });
      return res.ok ? { verified: true, accountId: config.senderEmail || null } : { verified: false, code: 'PROVIDER_AUTH_FAILED', httpStatus: res.status };
    } catch { return { verified: false, code: 'PROVIDER_UNREACHABLE' }; }
  },
  async dispatch({ secret, config = {}, payload = {}, consent, tenantId, locationId, actionHash, fetchFn = globalThis.fetch } = {}) {
    if (!consentOk(consent, 'email', payload)) return failure('CONSENT_REQUIRED');
    if (typeof secret !== 'string' || !secret.startsWith('re_')) return failure('INVALID_CREDENTIAL');
    if (!config.senderEmail) return failure('SENDER_EMAIL_REQUIRED');
    const input = validEmailPayload(payload); if (input.code) return failure(input.code);
    const key = makeIdempotencyKey({ tenantId, locationId, actionHash });
    const body = {
      from: config.senderName ? config.senderName + ' <' + config.senderEmail + '>' : config.senderEmail,
      to: input.to.map(item => item.email), subject: input.subject,
      ...(input.text ? { text: input.text } : {}), ...(input.html ? { html: input.html } : {}),
      ...(payload.cc ? { cc: emailRecipients(payload.cc).map(item => item.email) } : {}),
      ...(payload.bcc ? { bcc: emailRecipients(payload.bcc).map(item => item.email) } : {})
    };
    try {
      const headers = { ...bearer(secret), 'Content-Type': 'application/json' };
      if (key) headers['Idempotency-Key'] = key;
      const res = await request(fetchFn, 'https://api.resend.com/emails', { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await responseJson(res);
      if (!res.ok || typeof data.id !== 'string') return failure('PROVIDER_SEND_REJECTED', res.status);
      return { ok: true, providerAccepted: true, providerMessageId: data.id, provider: 'resend', httpStatus: res.status, idempotencyKey: key };
    } catch (err) {
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout|aborted/i.test(err?.message || '');
      return failure(isTimeout ? 'PROVIDER_TIMEOUT_INDETERMINATE' : 'PROVIDER_REQUEST_FAILED');
    }
  }
});

export const sendgridEmailAdapter = Object.freeze({
  id: 'adapter-sendgrid-email-v4', providerKey: 'email.sendgrid', channel: 'email',
  async verify({ secret, fetchFn = globalThis.fetch } = {}) {
    if (typeof secret !== 'string' || !/^SG\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(secret)) return { verified: false, code: 'INVALID_CREDENTIAL_FORMAT' };
    try {
      const res = await request(fetchFn, 'https://api.sendgrid.com/v3/scopes', { method: 'GET', headers: bearer(secret) });
      return res.ok ? { verified: true, accountId: null } : { verified: false, code: 'PROVIDER_AUTH_FAILED', httpStatus: res.status };
    } catch { return { verified: false, code: 'PROVIDER_UNREACHABLE' }; }
  },
  async dispatch({ secret, config = {}, payload = {}, consent, fetchFn = globalThis.fetch } = {}) {
    if (!consentOk(consent, 'email', payload)) return failure('CONSENT_REQUIRED');
    if (typeof secret !== 'string' || !secret.startsWith('SG.')) return failure('INVALID_CREDENTIAL');
    if (!config.senderEmail) return failure('SENDER_EMAIL_REQUIRED');
    const input = validEmailPayload(payload); if (input.code) return failure(input.code);
    const content = [];
    if (input.text) content.push({ type: 'text/plain', value: input.text });
    if (input.html) content.push({ type: 'text/html', value: input.html });
    const body = {
      personalizations: [{ to: input.to, ...(payload.cc ? { cc: emailRecipients(payload.cc) } : {}), ...(payload.bcc ? { bcc: emailRecipients(payload.bcc) } : {}) }],
      from: { email: config.senderEmail, ...(config.senderName ? { name: config.senderName } : {}) },
      subject: input.subject, content
    };
    try {
      const res = await request(fetchFn, 'https://api.sendgrid.com/v3/mail/send', {
        method: 'POST', headers: { ...bearer(secret), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (res.status !== 202) return failure('PROVIDER_SEND_REJECTED', res.status);
      return { ok: true, providerAccepted: true, providerMessageId: res.headers?.get?.('x-message-id') || null, provider: 'sendgrid', httpStatus: res.status };
    } catch (err) {
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout|aborted/i.test(err?.message || '');
      return failure(isTimeout ? 'PROVIDER_TIMEOUT_INDETERMINATE' : 'PROVIDER_REQUEST_FAILED');
    }
  }
});

export const twilioSmsAdapter = Object.freeze({
  id: 'adapter-twilio-sms-v2', providerKey: 'sms.twilio', channel: 'sms',
  async verify({ secret, config = {}, fetchFn = globalThis.fetch } = {}) {
    const sid = config.accountId || '';
    if (typeof secret !== 'string' || secret.length < 16 || !/^AC[0-9a-fA-F]{32}$/.test(sid)) return { verified: false, code: 'INVALID_CREDENTIAL_FORMAT' };
    try {
      const res = await request(fetchFn, 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '.json', { method: 'GET', headers: twilioAuth(sid, secret) });
      const data = await responseJson(res);
      return res.ok ? { verified: true, accountId: data.sid || sid } : { verified: false, code: 'PROVIDER_AUTH_FAILED', httpStatus: res.status };
    } catch { return { verified: false, code: 'PROVIDER_UNREACHABLE' }; }
  },
  async dispatch({ secret, config = {}, payload = {}, consent, fetchFn = globalThis.fetch } = {}) {
    if (!consentOk(consent, 'sms', payload)) return failure('CONSENT_REQUIRED');
    const sid = config.accountId || '', from = config.fromNumber || '';
    const to = String(payload.to || payload.phone || '').trim(), body = String(payload.body || payload.text || '').trim();
    if (typeof secret !== 'string' || secret.length < 16 || !/^AC[0-9a-fA-F]{32}$/.test(sid)) return failure('INVALID_CREDENTIAL');
    if (!/^\+[1-9]\d{7,14}$/.test(from) || !/^\+[1-9]\d{7,14}$/.test(to)) return failure('INVALID_PHONE_NUMBER');
    if (!body || body.length > 1600) return failure('INVALID_MESSAGE_BODY');
    try {
      const res = await request(fetchFn, 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
        method: 'POST', headers: { ...twilioAuth(sid, secret), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: from, Body: body })
      });
      const data = await responseJson(res);
      if (!res.ok || typeof data.sid !== 'string') return failure('PROVIDER_SEND_REJECTED', res.status);
      return { ok: true, providerAccepted: true, providerMessageId: data.sid, provider: 'twilio', httpStatus: res.status };
    } catch (err) {
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout|aborted/i.test(err?.message || '');
      return failure(isTimeout ? 'PROVIDER_TIMEOUT_INDETERMINATE' : 'PROVIDER_REQUEST_FAILED');
    }
  }
});

export const whatsappMetaAdapter = Object.freeze({
  id: 'adapter-whatsapp-meta-v27', providerKey: 'whatsapp.meta_cloud', channel: 'whatsapp',
  async verify({ secret, config = {}, fetchFn = globalThis.fetch } = {}) {
    const phoneId = config.phoneNumberId || '';
    if (typeof secret !== 'string' || secret.length < 20 || !/^\d{5,32}$/.test(phoneId)) return { verified: false, code: 'INVALID_CREDENTIAL_FORMAT' };
    try {
      const res = await request(fetchFn, 'https://graph.facebook.com/' + META_VERSION + '/' + encodeURIComponent(phoneId) + '?fields=id,display_phone_number,verified_name', { method: 'GET', headers: bearer(secret) });
      const data = await responseJson(res);
      return res.ok ? { verified: true, accountId: data.id || phoneId } : { verified: false, code: 'PROVIDER_AUTH_FAILED', httpStatus: res.status };
    } catch { return { verified: false, code: 'PROVIDER_UNREACHABLE' }; }
  },
  async dispatch({ secret, config = {}, payload = {}, consent, fetchFn = globalThis.fetch } = {}) {
    if (!consentOk(consent, 'whatsapp', payload)) return failure('CONSENT_REQUIRED');
    const phoneId = config.phoneNumberId || '', to = String(payload.to || payload.phone || '').replace(/[^0-9]/g, '');
    const message = String(payload.text || payload.body || '').trim();
    if (typeof secret !== 'string' || secret.length < 20 || !/^\d{5,32}$/.test(phoneId)) return failure('INVALID_CREDENTIAL');
    if (!/^\d{8,15}$/.test(to) || !message || message.length > 4096) return failure('INVALID_MESSAGE_BODY');
    try {
      const res = await request(fetchFn, 'https://graph.facebook.com/' + META_VERSION + '/' + encodeURIComponent(phoneId) + '/messages', {
        method: 'POST', headers: { ...bearer(secret), 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: message } })
      });
      const data = await responseJson(res), receipt = data.messages?.[0]?.id;
      if (!res.ok || typeof receipt !== 'string') return failure('PROVIDER_SEND_REJECTED', res.status);
      return { ok: true, providerAccepted: true, providerMessageId: receipt, provider: 'whatsapp.meta_cloud', httpStatus: res.status };
    } catch (err) {
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout|aborted/i.test(err?.message || '');
      return failure(isTimeout ? 'PROVIDER_TIMEOUT_INDETERMINATE' : 'PROVIDER_REQUEST_FAILED');
    }
  }
});

export const zapierWebhookAdapter = Object.freeze({
  id: 'adapter-zapier-webhook-v1', providerKey: 'zapier', channel: 'webhook',
  async verify({ config = {} } = {}) {
    const zapUrl = config.webhookUrl || config.url || '';
    if (!zapUrl || !zapUrl.startsWith('https://hooks.zapier.com/')) {
      return { verified: false, code: 'INVALID_ZAPIER_URL' };
    }
    return { verified: true, accountId: 'zapier_hooks' };
  },
  async dispatch({ config = {}, payload = {}, secret, tenantId, locationId, actionHash, signal, fetchFn = globalThis.fetch } = {}) {
    const zapUrl = config.webhookUrl || config.url || '';
    if (!zapUrl || !zapUrl.startsWith('https://hooks.zapier.com/')) {
      return failure('INVALID_ZAPIER_URL');
    }
    const key = makeIdempotencyKey({ tenantId, locationId, actionHash });
    const secretKey = secret || config.signingSecret || tenantId || 'operza_zapier_secret';
    const bodyStr = JSON.stringify(payload);
    const signature = createHmac('sha256', secretKey).update(bodyStr).digest('hex');
    try {
      const headers = {
        'Content-Type': 'application/json',
        'X-Operza-Signature': `sha256=${signature}`
      };
      if (key) headers['Idempotency-Key'] = key;
      const res = await (typeof fetchFn === 'function' ? fetchFn : globalThis.fetch)(zapUrl, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: signal || AbortSignal.timeout(10_000)
      });
      if (!res.ok) return failure('PROVIDER_SEND_REJECTED', res.status);
      return {
        ok: true,
        providerAccepted: true,
        providerMessageId: res.headers?.get?.('x-zapier-delivery-id') || ('zap_' + (actionHash ? actionHash.slice(0, 16) : 'msg')),
        provider: 'zapier',
        httpStatus: res.status,
        idempotencyKey: key
      };
    } catch (err) {
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout|aborted/i.test(err?.message || '');
      return failure(isTimeout ? 'PROVIDER_TIMEOUT_INDETERMINATE' : 'PROVIDER_REQUEST_FAILED', 0);
    }
  }
});

export const stripePaymentAdapter = Object.freeze({
  id: 'adapter-stripe-payments-disabled-v1', providerKey: 'payments.stripe', channel: 'payments',
  async verify() { return { verified: false, code: 'PAYMENTS_DISABLED_PENDING_COMPLIANCE' }; },
  async dispatch() { return failure('PAYMENTS_DISABLED_PENDING_COMPLIANCE'); }
});

export function createProviderAdapterRegistry(customAdapters = []) {
  const map = new Map([
    [resendEmailAdapter.providerKey, resendEmailAdapter],
    [sendgridEmailAdapter.providerKey, sendgridEmailAdapter],
    [twilioSmsAdapter.providerKey, twilioSmsAdapter],
    [whatsappMetaAdapter.providerKey, whatsappMetaAdapter],
    [zapierWebhookAdapter.providerKey, zapierWebhookAdapter],
    [stripePaymentAdapter.providerKey, stripePaymentAdapter]
  ]);
  for (const adapter of customAdapters) if (adapter?.providerKey) map.set(adapter.providerKey, adapter);
  return {
    get(key) {
      if (!key) return null;
      if (map.has(key)) return map.get(key);
      if (key === 'email' || key === 'resend') return map.get('email.resend') || null;
      if (key === 'sendgrid') return map.get('email.sendgrid') || null;
      if (key === 'sms' || key === 'twilio') return map.get('sms.twilio') || null;
      if (key === 'whatsapp' || key === 'meta') return map.get('whatsapp.meta_cloud') || null;
      if (key === 'zapier' || key === 'zapier_webhook' || key === 'automation.zapier.dispatch') return map.get('zapier') || null;
      if (key === 'stripe' || key === 'payments') return map.get('payments.stripe') || null;
      return null;
    },
    has(key) { return this.get(key) !== null; },
    list() { return [...map.values()]; },
    register(key, adapter) {
      if (typeof key === 'string' && adapter) {
        map.set(key, adapter);
      } else if (key && key.providerKey) {
        map.set(key.providerKey, key);
      }
    }
  };
}
