/**
 * ============================================================================
 * Operza AI Memory Manager 2.0 — Scoped, Consent-Gated & TTL Memory
 * ============================================================================
 * Enforces strict separation between user-private memory and agency-shared
 * knowledge, consent opt-out, TTL expiration, and secret/PII filtering.
 */

import { randomUUID } from 'node:crypto';

const SECRET_RE = /(password|passwd|secret|token|api[_-]?key|authorization|cookie|private[_-]?key|ssn|credit[_-]?card)/i;

export function createMemoryManagerV2({ now = () => Date.now() } = {}) {
  const entries = new Map();

  function createMemory({
    agencyId,
    locationId,
    scope = 'user',
    userId = null,
    agentId = null,
    memoryKey,
    content,
    consentGranted = true,
    ttlMs = 30 * 24 * 60 * 60 * 1000
  }) {
    if (!agencyId || !locationId) {
      throw Object.assign(new Error('Tenant context required'), { code: 'TENANT_CONTEXT_REQUIRED' });
    }
    if (!['user', 'agency'].includes(scope)) {
      throw Object.assign(new TypeError('scope must be user or agency'), { code: 'INVALID_MEMORY_SCOPE' });
    }
    if (scope === 'user' && !userId) {
      throw Object.assign(new TypeError('userId is required for user-scoped memory'), { code: 'USER_ID_REQUIRED' });
    }
    if (!consentGranted) {
      throw Object.assign(new Error('Memory storage requires explicit consent'), { code: 'MEMORY_CONSENT_REQUIRED' });
    }
    const text = String(content || '');
    if (!text.trim() || text.length > 4000) {
      throw Object.assign(new TypeError('Memory content must be 1-4000 chars'), { code: 'INVALID_MEMORY_CONTENT' });
    }
    if (SECRET_RE.test(text) || SECRET_RE.test(String(memoryKey || ''))) {
      throw Object.assign(new Error('Secrets and sensitive credentials cannot be stored in AI memory'), { code: 'SENSITIVE_MEMORY_REJECTED' });
    }

    const id = randomUUID();
    const record = {
      id,
      agencyId,
      locationId,
      scope,
      userId: scope === 'user' ? String(userId) : null,
      agentId,
      memoryKey: String(memoryKey || 'note'),
      content: text,
      consentGranted: true,
      expiresAt: ttlMs ? new Date(now() + ttlMs).toISOString() : null,
      createdAt: new Date(now()).toISOString()
    };
    entries.set(id, record);
    return record;
  }

  function retrieveMemories({ agencyId, locationId, userId = null, scope = 'all' } = {}) {
    const currentMs = now();
    const out = [];
    for (const rec of entries.values()) {
      if (String(rec.agencyId) !== String(agencyId) || String(rec.locationId) !== String(locationId)) continue;
      if (rec.expiresAt && Date.parse(rec.expiresAt) <= currentMs) continue;
      if (rec.scope === 'user') {
        if (!userId || String(rec.userId) !== String(userId)) continue;
      }
      if (scope !== 'all' && rec.scope !== scope) continue;
      out.push(rec);
    }
    return out;
  }

  function deleteMemory({ id, agencyId, locationId, userId = null }) {
    const rec = entries.get(id);
    if (!rec) return false;
    if (String(rec.agencyId) !== String(agencyId) || String(rec.locationId) !== String(locationId)) return false;
    if (rec.scope === 'user' && String(rec.userId) !== String(userId)) return false;
    return entries.delete(id);
  }

  return { createMemory, retrieveMemories, deleteMemory };
}
