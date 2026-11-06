const CHANNELS = new Set(['email', 'sms', 'whatsapp']);
const PURPOSES = new Set(['transactional', 'marketing', 'appointment', 'review_request']);
const SOURCES = new Set(['web_form', 'api', 'keyword_opt_out', 'manual', 'import']);

function invalid(message, code) {
  throw Object.assign(new TypeError(message), { code });
}

function matches(record, identity) {
  return record.tenantId === identity.tenantId &&
    record.locationId === identity.locationId &&
    record.contactId === identity.contactId &&
    record.channel === identity.channel &&
    record.purpose === identity.purpose;
}

export function recordConsent(input, { now = Date.now(), id = crypto.randomUUID() } = {}) {
  for (const field of ['tenantId', 'locationId', 'contactId']) {
    if (typeof input?.[field] !== 'string' || input[field].length < 3 || input[field].length > 180) {
      invalid(field + ' is required', 'INVALID_CONSENT_IDENTITY');
    }
  }
  if (!CHANNELS.has(input.channel) || !PURPOSES.has(input.purpose)) invalid('Channel or purpose is unsupported', 'INVALID_CONSENT_SCOPE');
  if (!['granted', 'revoked'].includes(input.status)) invalid('Consent status is invalid', 'INVALID_CONSENT_STATUS');
  if (!SOURCES.has(input.source)) invalid('Consent source is invalid', 'INVALID_CONSENT_SOURCE');
  if (input.status === 'granted' && input.source === 'import' && input.proofRef == null) {
    invalid('Imported consent requires an auditable proof reference', 'CONSENT_PROOF_REQUIRED');
  }
  const timestamp = new Date(now).toISOString();
  return {
    id,
    tenantId: input.tenantId,
    locationId: input.locationId,
    contactId: input.contactId,
    channel: input.channel,
    purpose: input.purpose,
    status: input.status,
    source: input.source,
    proofRef: typeof input.proofRef === 'string' ? input.proofRef.slice(0, 180) : null,
    capturedAt: timestamp,
    expiresAt: input.expiresAt || null,
    createdAt: timestamp
  };
}

export function evaluateCommunicationPolicy({
  consentRecords = [],
  identity,
  providerConnection,
  now = Date.now()
} = {}) {
  if (!identity || !identity.tenantId || !identity.locationId || !identity.contactId) {
    return { allowed: false, code: 'CONSENT_IDENTITY_REQUIRED' };
  }
  if (!CHANNELS.has(identity.channel) || !PURPOSES.has(identity.purpose)) {
    return { allowed: false, code: 'CONSENT_SCOPE_UNSUPPORTED' };
  }
  if (!providerConnection || providerConnection.tenantId !== identity.tenantId ||
      providerConnection.locationId !== identity.locationId ||
      providerConnection.channel !== identity.channel ||
      providerConnection.status !== 'verified' || providerConnection.revokedAt) {
    return { allowed: false, code: 'PROVIDER_NOT_VERIFIED' };
  }
  const latest = consentRecords.filter(record => matches(record, identity))
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
  if (!latest) return { allowed: false, code: 'CONSENT_NOT_FOUND' };
  if (latest.status !== 'granted') return { allowed: false, code: 'CONSENT_REVOKED', consentId: latest.id };
  if (latest.expiresAt && Date.parse(latest.expiresAt) <= now) {
    return { allowed: false, code: 'CONSENT_EXPIRED', consentId: latest.id };
  }
  return { allowed: true, code: 'CONSENT_VALID', consentId: latest.id, source: latest.source };
}
