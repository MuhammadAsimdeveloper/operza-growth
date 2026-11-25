import { randomUUID } from 'node:crypto';

const VALID_CHANNELS = new Set(['email', 'sms', 'whatsapp']);
const VALID_PURPOSES = new Set(['transactional', 'marketing', 'appointment', 'review_request']);
const VALID_STATUSES = new Set(['granted', 'revoked']);
const VALID_SOURCES = new Set(['web_form', 'api', 'keyword_opt_out', 'manual', 'import']);

function mapConsentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    contactId: row.contact_id,
    channel: row.channel,
    purpose: row.purpose,
    status: row.status,
    source: row.source,
    proofRef: row.proof_ref || null,
    capturedAt: row.captured_at,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at
  };
}

function assertScope(tx, agencyId, locationId) {
  const a = agencyId || tx?.agencyId;
  const l = locationId || tx?.locationId;
  if (!a || !l) {
    throw new Error('CommunicationConsentsRepository requires explicit agencyId and locationId.');
  }
  return { agencyId: a, locationId: l };
}

export function createCommunicationConsentsRepository() {
  return {
    async recordConsent(tx, input = {}) {
      const scope = assertScope(tx, input.agencyId, input.locationId);
      if (!input.contactId) throw new Error('contactId is required.');
      if (!VALID_CHANNELS.has(input.channel)) {
        throw new Error(`Invalid consent channel: ${input.channel}`);
      }
      const purpose = input.purpose || 'transactional';
      if (!VALID_PURPOSES.has(purpose)) {
        throw new Error(`Invalid consent purpose: ${purpose}`);
      }
      const status = input.status || 'granted';
      if (!VALID_STATUSES.has(status)) {
        throw new Error(`Invalid consent status: ${status}`);
      }
      const source = input.source || (status === 'revoked' ? 'api' : 'manual');
      if (!VALID_SOURCES.has(source)) {
        throw new Error(`Invalid consent source: ${source}`);
      }
      if (status === 'granted' && (!input.proofRef || String(input.proofRef).trim().length < 3)) {
        throw new Error('proofRef (min 3 chars) is required when granting consent.');
      }

      const id = input.id || randomUUID();
      const capturedAt = input.capturedAt || new Date().toISOString();
      const res = await tx.query(
        `INSERT INTO communication_consents (
          id, agency_id, location_id, contact_id, channel, purpose,
          status, source, proof_ref, captured_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          id,
          scope.agencyId,
          scope.locationId,
          input.contactId,
          input.channel,
          purpose,
          status,
          source,
          input.proofRef || null,
          capturedAt,
          input.expiresAt || null
        ]
      );
      return mapConsentRow(res.rows[0]);
    },

    async listConsents(tx, { agencyId, locationId, contactId = null, channel = null, limit = 100 } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      const params = [scope.agencyId, scope.locationId];
      const filters = ['agency_id = $1', 'location_id = $2'];
      if (contactId) {
        params.push(contactId);
        filters.push(`contact_id = $${params.length}`);
      }
      if (channel && VALID_CHANNELS.has(channel)) {
        params.push(channel);
        filters.push(`channel = $${params.length}`);
      }
      params.push(Math.min(500, Math.max(1, Number(limit) || 100)));
      const res = await tx.query(
        `SELECT * FROM communication_consents
         WHERE ${filters.join(' AND ')}
         ORDER BY captured_at DESC, created_at DESC
         LIMIT $${params.length}`,
        params
      );
      return res.rows.map(mapConsentRow);
    },

    async revokeConsent(tx, { agencyId, locationId, consentId, source = 'api', proofRef = null } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      const all = await this.listConsents(tx, {
        agencyId: scope.agencyId,
        locationId: scope.locationId,
        limit: 500
      });
      const existing = all.find(c => c.id === consentId);
      if (!existing) return null;

      return this.recordConsent(tx, {
        agencyId: scope.agencyId,
        locationId: scope.locationId,
        contactId: existing.contactId,
        channel: existing.channel,
        purpose: existing.purpose,
        status: 'revoked',
        source,
        proofRef: proofRef || `revoked:${existing.id}`
      });
    },

    async isChannelAllowed(tx, { agencyId, locationId, contactId, channel, purpose = 'transactional', now = new Date() } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      if (!contactId || !VALID_CHANNELS.has(channel)) {
        return { allowed: true, reason: 'untracked_channel_or_contact' };
      }

      const records = await this.listConsents(tx, {
        agencyId: scope.agencyId,
        locationId: scope.locationId,
        contactId,
        limit: 200
      });

      const channelRecords = records.filter(r => r.channel === channel);
      if (channelRecords.length === 0) {
        if (purpose === 'marketing') {
          return { allowed: false, reason: 'marketing_opt_in_required' };
        }
        return { allowed: true, reason: 'no_revocation_recorded' };
      }

      // If any keyword opt-out or latest record on this channel is revoked, block outbound dispatch
      const latestForChannel = channelRecords[0];
      if (latestForChannel.status === 'revoked') {
        return { allowed: false, reason: 'consent_revoked', record: latestForChannel };
      }

      const matchingPurpose = channelRecords.find(r => r.purpose === purpose) || latestForChannel;
      if (matchingPurpose.status === 'revoked') {
        return { allowed: false, reason: 'consent_revoked', record: matchingPurpose };
      }

      if (matchingPurpose.expiresAt && new Date(matchingPurpose.expiresAt).getTime() <= now.getTime()) {
        return { allowed: false, reason: 'consent_expired', record: matchingPurpose };
      }

      return { allowed: true, reason: 'consent_granted', record: matchingPurpose };
    }
  };
}
