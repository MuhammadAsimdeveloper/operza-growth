import { randomUUID } from 'node:crypto';

const VALID_REVIEW_STATUSES = new Set(['new', 'published', 'hidden', 'flagged', 'archived']);
const VALID_CHANNELS = new Set(['email', 'sms', 'whatsapp']);

function mapReviewRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    contactId: row.contact_id || null,
    contactName: row.contact_name,
    email: row.email || '',
    rating: Number(row.rating),
    text: row.text || '',
    source: row.source,
    status: row.status,
    reply: row.reply || null,
    repliedAt: row.replied_at || null,
    receivedAt: row.received_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapReviewRequestRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    contactId: row.contact_id,
    channel: row.channel,
    message: row.message,
    status: row.status,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at || null,
    createdAt: row.created_at
  };
}

function assertScope(tx, agencyId, locationId) {
  const a = agencyId || tx?.agencyId;
  const l = locationId || tx?.locationId;
  if (!a || !l) {
    throw new Error('ReviewsRepository requires explicit agencyId and locationId.');
  }
  return { agencyId: a, locationId: l };
}

export function createReviewsRepository() {
  return {
    async listReviews(tx, { agencyId, locationId, status = null, limit = 100 } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      const params = [scope.agencyId, scope.locationId];
      const filters = ['agency_id = $1', 'location_id = $2'];
      if (status && VALID_REVIEW_STATUSES.has(status)) {
        params.push(status);
        filters.push(`status = $${params.length}`);
      }
      params.push(Math.min(500, Math.max(1, Number(limit) || 100)));
      const res = await tx.query(
        `SELECT * FROM reviews WHERE ${filters.join(' AND ')} ORDER BY received_at DESC LIMIT $${params.length}`,
        params
      );
      return res.rows.map(mapReviewRow);
    },

    async getReview(tx, { agencyId, locationId, id } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      if (!id) return null;
      const res = await tx.query(
        'SELECT * FROM reviews WHERE agency_id = $1 AND location_id = $2 AND id = $3',
        [scope.agencyId, scope.locationId, id]
      );
      return mapReviewRow(res.rows[0]);
    },

    async createReview(tx, input = {}) {
      const scope = assertScope(tx, input.agencyId, input.locationId);
      const rating = Math.max(1, Math.min(5, Math.round(Number(input.rating) || 5)));
      const status = VALID_REVIEW_STATUSES.has(input.status) ? input.status : 'new';
      const res = await tx.query(
        `INSERT INTO reviews (
          id, agency_id, location_id, contact_id, contact_name, email,
          rating, text, source, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          input.id || randomUUID(),
          scope.agencyId,
          scope.locationId,
          input.contactId || null,
          String(input.contactName || 'Verified Client').trim() || 'Verified Client',
          input.email ? String(input.email).toLowerCase().trim() : '',
          rating,
          String(input.text || ''),
          String(input.source || 'Direct Client Portal'),
          status
        ]
      );
      return mapReviewRow(res.rows[0]);
    },

    async updateReview(tx, { agencyId, locationId, id, patch = {} } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      const existing = await this.getReview(tx, { agencyId: scope.agencyId, locationId: scope.locationId, id });
      if (!existing) return null;

      const status = patch.status && VALID_REVIEW_STATUSES.has(patch.status) ? patch.status : existing.status;
      const reply = patch.reply !== undefined ? patch.reply : existing.reply;
      const repliedAt = patch.reply ? (existing.repliedAt || new Date().toISOString()) : existing.repliedAt;

      const res = await tx.query(
        `UPDATE reviews
         SET status = $4, reply = $5, replied_at = $6, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [scope.agencyId, scope.locationId, id, status, reply, repliedAt]
      );
      return mapReviewRow(res.rows[0]);
    },

    async createReviewRequest(tx, input = {}) {
      const scope = assertScope(tx, input.agencyId, input.locationId);
      if (!input.contactId) throw new Error('contactId is required.');
      const channel = VALID_CHANNELS.has(input.channel) ? input.channel : 'email';
      const status = input.status === 'sent' ? 'sent' : 'scheduled';
      const sentAt = status === 'sent' ? (input.sentAt || new Date().toISOString()) : null;
      const res = await tx.query(
        `INSERT INTO review_requests (
          id, agency_id, location_id, contact_id, channel, message, status, scheduled_at, sent_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          input.id || randomUUID(),
          scope.agencyId,
          scope.locationId,
          input.contactId,
          channel,
          String(input.message || '').trim(),
          status,
          input.scheduledAt || new Date().toISOString(),
          sentAt
        ]
      );
      return mapReviewRequestRow(res.rows[0]);
    }
  };
}
