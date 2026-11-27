import { createHash, randomBytes } from 'node:crypto';

export function hashPortalToken(rawToken) {
  return createHash('sha256').update(String(rawToken || '')).digest('hex');
}

export function generatePortalToken(bytes = 32) {
  const rawToken = randomBytes(bytes).toString('base64url');
  return { rawToken, tokenHash: hashPortalToken(rawToken) };
}

export function validatePortalRedirect(target = '/portal') {
  const val = String(target || '').trim();
  if (!val.startsWith('/') || val.startsWith('//') || /[\r\n]/.test(val)) {
    return '/portal';
  }
  return val;
}

export function verifyMagicLinkRecord(record, { now = new Date(), expectedAgencyId = null } = {}) {
  if (!record) {
    return { valid: false, code: 'MAGIC_LINK_INVALID' };
  }
  if (expectedAgencyId && record.agency_id !== expectedAgencyId && record.agencyId !== expectedAgencyId) {
    return { valid: false, code: 'MAGIC_LINK_AGENCY_MISMATCH' };
  }
  if (record.revoked_at || record.revokedAt) {
    return { valid: false, code: 'MAGIC_LINK_REVOKED' };
  }
  if (record.consumed_at || record.consumedAt) {
    return { valid: false, code: 'MAGIC_LINK_ALREADY_USED' };
  }
  const expires = new Date(record.expires_at || record.expiresAt).getTime();
  if (!Number.isFinite(expires) || expires <= now.getTime()) {
    return { valid: false, code: 'MAGIC_LINK_EXPIRED' };
  }
  return { valid: true, role: 'external_customer' };
}

export function verifyPortalSessionRecord(session, { now = new Date(), expectedAgencyId = null } = {}) {
  if (!session) {
    return { valid: false, code: 'PORTAL_SESSION_INVALID' };
  }
  if (expectedAgencyId && session.agency_id !== expectedAgencyId && session.agencyId !== expectedAgencyId) {
    return { valid: false, code: 'PORTAL_SESSION_TENANT_MISMATCH' };
  }
  if (session.revoked_at || session.revokedAt) {
    return { valid: false, code: 'PORTAL_SESSION_REVOKED' };
  }
  const expires = new Date(session.expires_at || session.expiresAt).getTime();
  if (!Number.isFinite(expires) || expires <= now.getTime()) {
    return { valid: false, code: 'PORTAL_SESSION_EXPIRED' };
  }
  return {
    valid: true,
    role: 'external_customer',
    agencyId: session.agency_id || session.agencyId,
    locationId: session.location_id || session.locationId,
    contactId: session.contact_id || session.contactId
  };
}

export function assertCustomerOwnsRecord(record, { agencyId, locationId, contactId } = {}) {
  if (!record) {
    throw Object.assign(new Error('Record not found'), { code: 'NOT_FOUND', status: 404 });
  }
  const recAgency = record.agency_id || record.agencyId;
  const recLocation = record.location_id || record.locationId;
  const recContact = record.contact_id || record.contactId;
  if (recAgency !== agencyId || recLocation !== locationId || recContact !== contactId) {
    throw Object.assign(new Error('Forbidden: record does not belong to authenticated customer'), {
      code: 'CUSTOMER_OWNERSHIP_DENIED',
      status: 403
    });
  }
  return true;
}

const DEFAULT_EDITABLE_FIELDS = new Set(['firstName', 'lastName', 'phone', 'company', 'timezone', 'preferredLanguage']);

export function sanitizeCustomerProfilePatch(patch = {}, allowedFields = null) {
  const allow = Array.isArray(allowedFields) ? new Set(allowedFields) : DEFAULT_EDITABLE_FIELDS;
  const clean = {};
  const rejected = [];
  for (const [k, v] of Object.entries(patch || {})) {
    if (allow.has(k)) {
      clean[k] = typeof v === 'string' ? v.trim() : v;
    } else {
      rejected.push(k);
    }
  }
  if (rejected.length > 0) {
    throw Object.assign(new Error(`Restricted profile fields cannot be modified: ${rejected.join(', ')}`), {
      code: 'RESTRICTED_PROFILE_FIELD',
      rejected
    });
  }
  return clean;
}

export function filterCustomerVisibleMessages(messages = []) {
  return (messages || []).filter((m) => {
    const type = m.sender_type || m.senderType || '';
    const visibility = m.visibility || m.metadata?.visibility || 'public';
    return type !== 'internal_note' && !m.isInternal && visibility !== 'internal';
  });
}

const REQUEST_TRANSITIONS = Object.freeze({
  requested: new Set(['approved', 'rejected']),
  approved: new Set(['completed']),
  rejected: new Set([]),
  completed: new Set([])
});

export function canTransitionPortalRequest(fromStatus, toStatus) {
  return Boolean(REQUEST_TRANSITIONS[fromStatus]?.has(toStatus));
}

export function isSensitiveSelfServiceRequest(requestType) {
  return ['refund_review', 'order_cancellation', 'account_closure', 'data_export'].includes(requestType);
}
