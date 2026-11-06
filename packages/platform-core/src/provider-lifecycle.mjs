const REF = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{1,180}$/;
const ALLOWED_CONFIG = new Set(['accountId', 'region', 'senderEmail', 'senderName', 'phoneNumberId', 'businessAccountId', 'webhookId']);

export const PROVIDER_CATALOG = Object.freeze([
  Object.freeze({ key: 'email.sendgrid', channel: 'email', label: 'SendGrid Email', status: 'adapter_required' }),
  Object.freeze({ key: 'email.resend', channel: 'email', label: 'Resend Email', status: 'adapter_required' }),
  Object.freeze({ key: 'sms.twilio', channel: 'sms', label: 'Twilio SMS', status: 'adapter_required' }),
  Object.freeze({ key: 'whatsapp.meta_cloud', channel: 'whatsapp', label: 'WhatsApp Cloud API', status: 'adapter_required' }),
  Object.freeze({ key: 'payments.stripe', channel: 'payments', label: 'Stripe Payments', status: 'disabled_pending_compliance' })
]);

const PROVIDERS = new Map(PROVIDER_CATALOG.map(provider => [provider.key, provider]));

function fail(message, code) {
  throw Object.assign(new TypeError(message), { code });
}

function safeConfig(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('Provider config must be an object', 'INVALID_PROVIDER_CONFIG');
  const entries = Object.entries(config);
  if (entries.length > 20) fail('Provider config has too many fields', 'INVALID_PROVIDER_CONFIG');
  const output = {};
  for (const [key, value] of entries) {
    if (!ALLOWED_CONFIG.has(key)) fail('Unsupported provider config field: ' + key, 'INVALID_PROVIDER_CONFIG');
    if (typeof value !== 'string' || value.length > 200 || /https?:\/\/|bearer\s|-----BEGIN/i.test(value)) {
      fail('Provider config values must be short, non-secret strings', 'INVALID_PROVIDER_CONFIG');
    }
    output[key] = value.trim();
  }
  return output;
}

function assertTenant(input) {
  for (const key of ['tenantId', 'locationId']) {
    if (typeof input[key] !== 'string' || !REF.test(input[key])) fail(key + ' is invalid', 'INVALID_REFERENCE');
  }
}

/** Store a reference to a server-side secret, never the secret itself. */
export function createProviderConnection(input, { now = Date.now(), id = crypto.randomUUID() } = {}) {
  if (!input || typeof input !== 'object') fail('Provider connection input is required', 'INVALID_PROVIDER_CONNECTION');
  assertTenant(input);
  const provider = PROVIDERS.get(input.providerKey);
  if (!provider) fail('Provider is not in the supported catalog', 'UNSUPPORTED_PROVIDER');
  if (typeof input.secretRef !== 'string' || !/^(env|vault|kms):[A-Za-z0-9_.:/-]{2,180}$/.test(input.secretRef)) {
    fail('A server-side env:, vault: or kms: secret reference is required', 'INVALID_SECRET_REFERENCE');
  }
  const timestamp = new Date(now).toISOString();
  return {
    id,
    tenantId: input.tenantId,
    locationId: input.locationId,
    providerKey: provider.key,
    channel: provider.channel,
    label: typeof input.label === 'string' ? input.label.slice(0, 100) : provider.label,
    secretRef: input.secretRef,
    config: safeConfig(input.config),
    status: 'pending_verification',
    createdAt: timestamp,
    updatedAt: timestamp,
    verifiedAt: null,
    revokedAt: null,
    lastCheckCode: null
  };
}

export async function verifyProviderConnection(connection, { secretResolver, adapter, now = Date.now() } = {}) {
  if (!connection || connection.status === 'revoked') {
    return { ok: false, code: 'CONNECTION_REVOKED', connection };
  }
  if (!connection.secretRef || typeof secretResolver?.resolve !== 'function') {
    return { ok: false, code: 'SECRET_RESOLVER_UNAVAILABLE', connection };
  }
  if (typeof adapter?.verify !== 'function' || adapter.providerKey !== connection.providerKey) {
    return { ok: false, code: 'PROVIDER_ADAPTER_UNAVAILABLE', connection };
  }
  let secret;
  try {
    secret = await secretResolver.resolve(connection.secretRef);
    if (typeof secret !== 'string' || secret.length < 1 || secret.length > 16_384) {
      return { ok: false, code: 'SECRET_NOT_FOUND', connection };
    }
    const result = await adapter.verify({ secret, config: connection.config });
    if (result?.verified !== true) {
      const updated = { ...connection, status: 'degraded', lastCheckCode: 'PROVIDER_VERIFICATION_FAILED', updatedAt: new Date(now).toISOString() };
      return { ok: false, code: 'PROVIDER_VERIFICATION_FAILED', connection: updated };
    }
    const updated = {
      ...connection,
      status: 'verified',
      verifiedAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      lastCheckCode: null,
      verification: { adapter: adapter.id || connection.providerKey, accountId: typeof result.accountId === 'string' ? result.accountId.slice(0, 120) : null }
    };
    return { ok: true, code: 'PROVIDER_VERIFIED', connection: updated };
  } catch {
    const updated = { ...connection, status: 'degraded', lastCheckCode: 'PROVIDER_VERIFICATION_ERROR', updatedAt: new Date(now).toISOString() };
    return { ok: false, code: 'PROVIDER_VERIFICATION_ERROR', connection: updated };
  } finally {
    secret = undefined;
  }
}

export function revokeProviderConnection(connection, { now = Date.now() } = {}) {
  if (!connection || connection.status === 'revoked') return connection;
  return { ...connection, status: 'revoked', revokedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), lastCheckCode: 'CONNECTION_REVOKED' };
}

export function markProviderDegraded(connection, code = 'PROVIDER_UNAVAILABLE', { now = Date.now() } = {}) {
  if (!connection || connection.status === 'revoked') return connection;
  return { ...connection, status: 'degraded', lastCheckCode: String(code).slice(0, 80), updatedAt: new Date(now).toISOString() };
}

export function providerMayDispatch(connection) {
  return Boolean(connection && connection.status === 'verified' && connection.revokedAt == null);
}

export function publicProviderConnection(connection) {
  if (!connection) return null;
  return {
    id: connection.id,
    providerKey: connection.providerKey,
    channel: connection.channel,
    label: connection.label,
    status: connection.status,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    verifiedAt: connection.verifiedAt,
    revokedAt: connection.revokedAt,
    lastCheckCode: connection.lastCheckCode || null,
    secretConfigured: Boolean(connection.secretRef)
  };
}
