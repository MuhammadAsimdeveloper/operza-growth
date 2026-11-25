import { randomUUID } from 'node:crypto';

const VALID_CHANNELS = new Set(['sms', 'email', 'whatsapp', 'meta', 'webchat', 'voice', 'other']);
const VALID_STATUSES = new Set(['open', 'pending', 'resolved', 'closed', 'archived']);
const VALID_DELIVERY_STATUSES = new Set([
  'queued', 'processing', 'sent', 'delivered', 'failed', 'read', 'cancelled'
]);

function mapConversationRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    contactId: row.contact_id || null,
    contactName: row.contact_name,
    channel: row.channel,
    subject: row.subject || null,
    status: row.status,
    assignedTo: row.assigned_to || null,
    lastMessage: row.last_message || '',
    lastMessageAt: row.last_message_at || null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMessageRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id || null,
    channel: row.channel,
    direction: row.direction,
    senderType: row.sender_type,
    sender: row.sender_type === 'contact' ? 'contact' : 'agent',
    senderName: row.sender_name || null,
    subject: row.subject || null,
    content: row.body,
    body: row.body,
    deliveryStatus: row.delivery_status,
    provider: row.provider || null,
    providerMessageId: row.provider_message_id || null,
    idempotencyKey: row.idempotency_key || null,
    errorCode: row.error_code || null,
    metadata: row.metadata || {},
    sentAt: row.sent_at || null,
    deliveredAt: row.delivered_at || null,
    timestamp: row.created_at,
    createdAt: row.created_at
  };
}

function assertScope(tx, agencyId, locationId) {
  const a = agencyId || tx?.agencyId;
  const l = locationId || tx?.locationId;
  if (!a || !l) {
    throw new Error('ConversationsRepository requires explicit agencyId and locationId.');
  }
  return { agencyId: a, locationId: l };
}

export function createConversationsRepository() {
  return {
    async listConversations(tx, { agencyId, locationId, contactId = null, channel = null, status = null, limit = 100, offset = 0 } = {}) {
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
      if (status && VALID_STATUSES.has(status)) {
        params.push(status);
        filters.push(`status = $${params.length}`);
      }
      params.push(Math.min(500, Math.max(1, Number(limit) || 100)));
      params.push(Math.max(0, Number(offset) || 0));

      const res = await tx.query(
        `SELECT * FROM conversations WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      return res.rows.map(mapConversationRow);
    },

    async getConversation(tx, { agencyId, locationId, id, includeMessages = true } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      if (!id) return null;
      const res = await tx.query(
        'SELECT * FROM conversations WHERE agency_id = $1 AND location_id = $2 AND id = $3',
        [scope.agencyId, scope.locationId, id]
      );
      const conv = mapConversationRow(res.rows[0]);
      if (!conv) return null;
      if (includeMessages) {
        conv.messages = await this.listMessages(tx, {
          agencyId: scope.agencyId,
          locationId: scope.locationId,
          conversationId: conv.id
        });
      }
      return conv;
    },

    async createConversation(tx, input = {}) {
      const scope = assertScope(tx, input.agencyId, input.locationId);
      const id = input.id || randomUUID();
      const channel = VALID_CHANNELS.has(input.channel) ? input.channel : 'sms';
      const status = VALID_STATUSES.has(input.status) ? input.status : 'open';
      const contactName = String(input.contactName || 'Unknown Contact').trim() || 'Unknown Contact';
      const lastMessage = input.lastMessage ? String(input.lastMessage) : '';
      const lastMessageAt = input.lastMessageAt || (lastMessage ? new Date().toISOString() : null);

      const res = await tx.query(
        `INSERT INTO conversations (
          id, agency_id, location_id, contact_id, contact_name, channel, subject,
          status, assigned_to, last_message, last_message_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          id,
          scope.agencyId,
          scope.locationId,
          input.contactId || null,
          contactName,
          channel,
          input.subject || null,
          status,
          input.assignedTo || null,
          lastMessage,
          lastMessageAt,
          JSON.stringify(input.metadata || {})
        ]
      );
      const conv = mapConversationRow(res.rows[0]);
      if (conv) conv.messages = [];
      return conv;
    },

    async findOrCreateConversation(tx, input = {}) {
      const scope = assertScope(tx, input.agencyId, input.locationId);
      const existing = await this.listConversations(tx, {
        agencyId: scope.agencyId,
        locationId: scope.locationId,
        contactId: input.contactId || null,
        channel: input.channel || null,
        limit: 10
      });
      const matched = existing.find(c =>
        (input.contactId && c.contactId === input.contactId && (!input.channel || c.channel === input.channel)) ||
        (input.contactName && c.contactName === input.contactName)
      );
      if (matched) {
        matched.messages = await this.listMessages(tx, {
          agencyId: scope.agencyId,
          locationId: scope.locationId,
          conversationId: matched.id
        });
        return matched;
      }
      return this.createConversation(tx, input);
    },

    async updateConversation(tx, { agencyId, locationId, id, patch = {} } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      const existing = await this.getConversation(tx, {
        agencyId: scope.agencyId,
        locationId: scope.locationId,
        id,
        includeMessages: false
      });
      if (!existing) return null;

      const nextStatus = patch.status && VALID_STATUSES.has(patch.status) ? patch.status : existing.status;
      const nextChannel = patch.channel && VALID_CHANNELS.has(patch.channel) ? patch.channel : existing.channel;
      const nextAssigned = patch.assignedTo !== undefined ? patch.assignedTo : existing.assignedTo;
      const nextSubject = patch.subject !== undefined ? patch.subject : existing.subject;

      const res = await tx.query(
        `UPDATE conversations
         SET status = $4, channel = $5, assigned_to = $6, subject = $7, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [scope.agencyId, scope.locationId, id, nextStatus, nextChannel, nextAssigned, nextSubject]
      );
      return mapConversationRow(res.rows[0]);
    },

    async deleteConversation(tx, { agencyId, locationId, id } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      const res = await tx.query(
        'DELETE FROM conversations WHERE agency_id = $1 AND location_id = $2 AND id = $3 RETURNING id',
        [scope.agencyId, scope.locationId, id]
      );
      return res.rowCount > 0;
    },

    async listMessages(tx, { agencyId, locationId, conversationId, limit = 200 } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      const res = await tx.query(
        `SELECT * FROM messages
         WHERE agency_id = $1 AND location_id = $2 AND conversation_id = $3
         ORDER BY created_at ASC LIMIT $4`,
        [scope.agencyId, scope.locationId, conversationId, Math.min(500, Math.max(1, Number(limit) || 200))]
      );
      return res.rows.map(mapMessageRow);
    },

    async appendMessage(tx, input = {}) {
      const scope = assertScope(tx, input.agencyId, input.locationId);
      if (!input.conversationId) {
        throw new Error('conversationId is required to append a message.');
      }

      const channel = VALID_CHANNELS.has(input.channel) ? input.channel : 'sms';
      const direction = input.direction === 'inbound' ? 'inbound' : 'outbound';
      const senderType = ['agent', 'contact', 'bot', 'system', 'campaign'].includes(input.senderType)
        ? input.senderType
        : (direction === 'inbound' ? 'contact' : 'agent');
      const deliveryStatus = VALID_DELIVERY_STATUSES.has(input.deliveryStatus)
        ? input.deliveryStatus
        : (direction === 'inbound' ? 'delivered' : 'queued');
      const body = String(input.body ?? input.content ?? '');
      const nowIso = new Date().toISOString();

      const res = await tx.query(
        `INSERT INTO messages (
          id, agency_id, location_id, conversation_id, contact_id, channel, direction,
          sender_type, sender_name, subject, body, delivery_status, provider,
          provider_message_id, idempotency_key, error_code, metadata, sent_at, delivered_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        ON CONFLICT DO NOTHING
        RETURNING *`,
        [
          input.id || randomUUID(),
          scope.agencyId,
          scope.locationId,
          input.conversationId,
          input.contactId || null,
          channel,
          direction,
          senderType,
          input.senderName || null,
          input.subject || null,
          body,
          deliveryStatus,
          input.provider || null,
          input.providerMessageId || null,
          input.idempotencyKey || null,
          input.errorCode || null,
          JSON.stringify(input.metadata || {}),
          deliveryStatus === 'sent' || deliveryStatus === 'delivered' ? (input.sentAt || nowIso) : null,
          deliveryStatus === 'delivered' ? (input.deliveredAt || nowIso) : null
        ]
      );

      if (res.rowCount === 0 && input.provider && input.providerMessageId) {
        const existing = await tx.query(
          `SELECT * FROM messages
           WHERE agency_id = $1 AND location_id = $2 AND provider = $3 AND provider_message_id = $4
           LIMIT 1`,
          [scope.agencyId, scope.locationId, input.provider, input.providerMessageId]
        );
        return { deduplicated: true, message: mapMessageRow(existing.rows[0]) };
      }

      if (res.rowCount === 0 && input.idempotencyKey) {
        const existing = await tx.query(
          `SELECT * FROM messages
           WHERE agency_id = $1 AND location_id = $2 AND idempotency_key = $3
           LIMIT 1`,
          [scope.agencyId, scope.locationId, input.idempotencyKey]
        );
        return { deduplicated: true, message: mapMessageRow(existing.rows[0]) };
      }

      await tx.query(
        `UPDATE conversations
         SET last_message = $4, last_message_at = $5, updated_at = $5
         WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [scope.agencyId, scope.locationId, input.conversationId, body.slice(0, 500), nowIso]
      );

      return { deduplicated: false, message: mapMessageRow(res.rows[0]) };
    },

    async updateMessageDeliveryStatus(tx, { agencyId, locationId, id = null, providerMessageId = null, deliveryStatus, errorCode = null } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      if (!VALID_DELIVERY_STATUSES.has(deliveryStatus)) {
        throw new Error(`Invalid deliveryStatus: ${deliveryStatus}`);
      }
      const identifier = id || providerMessageId;
      if (!identifier) {
        throw new Error('id or providerMessageId is required.');
      }

      const res = await tx.query(
        `UPDATE messages
         SET delivery_status = $4,
             error_code = COALESCE($5, error_code),
             sent_at = CASE WHEN $4 IN ('sent', 'delivered') AND sent_at IS NULL THEN now() ELSE sent_at END,
             delivered_at = CASE WHEN $4 = 'delivered' AND delivered_at IS NULL THEN now() ELSE delivered_at END
         WHERE agency_id = $1 AND location_id = $2 AND (id::text = $3 OR provider_message_id = $3)
         RETURNING *`,
        [scope.agencyId, scope.locationId, String(identifier), deliveryStatus, errorCode]
      );
      return mapMessageRow(res.rows[0]);
    }
  };
}
