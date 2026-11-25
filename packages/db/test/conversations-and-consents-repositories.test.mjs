import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConversationsRepository,
  createCommunicationConsentsRepository
} from '../lib/database.mjs';

const AGENCY_A = '11111111-1111-4111-8111-111111111111';
const LOCATION_A = '22222222-2222-4222-8222-222222222222';
const AGENCY_B = '33333333-3333-4333-8333-333333333333';
const LOCATION_B = '44444444-4444-4444-8444-444444444444';
const CONTACT_1 = '55555555-5555-4555-8555-555555555555';

function makeMockTx(store = { conversations: [], messages: [], consents: [] }) {
  const queries = [];
  const tx = {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    actorId: 'user-1',
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('INSERT INTO conversations')) {
        const [id, agencyId, locationId, contactId, contactName, channel, subject, status, assignedTo, lastMessage, lastMessageAt, metadata] = params;
        const row = {
          id,
          agency_id: agencyId,
          location_id: locationId,
          contact_id: contactId,
          contact_name: contactName,
          channel,
          subject,
          status,
          assigned_to: assignedTo,
          last_message: lastMessage,
          last_message_at: lastMessageAt,
          metadata: typeof metadata === 'string' ? JSON.parse(metadata) : metadata,
          created_at: '2026-11-25T10:00:00.000Z',
          updated_at: '2026-11-25T10:00:00.000Z'
        };
        store.conversations.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (normalized.startsWith('SELECT * FROM conversations WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
        const [agencyId, locationId, id] = params;
        const found = store.conversations.filter(c => c.agency_id === agencyId && c.location_id === locationId && c.id === id);
        return { rows: found, rowCount: found.length };
      }

      if (normalized.startsWith('SELECT * FROM conversations WHERE agency_id = $1 AND location_id = $2')) {
        const [agencyId, locationId] = params;
        const found = store.conversations.filter(c => c.agency_id === agencyId && c.location_id === locationId);
        return { rows: found, rowCount: found.length };
      }

      if (normalized.startsWith('INSERT INTO messages')) {
        const [id, agencyId, locationId, conversationId, contactId, channel, direction, senderType, senderName, subject, body, deliveryStatus, provider, providerMessageId, idempotencyKey, errorCode, metadata, sentAt, deliveredAt] = params;
        if (provider && providerMessageId) {
          const existing = store.messages.find(
            m => m.agency_id === agencyId && m.location_id === locationId && m.provider === provider && m.provider_message_id === providerMessageId
          );
          if (existing) {
            return { rows: [], rowCount: 0 };
          }
        }
        if (idempotencyKey) {
          const existing = store.messages.find(
            m => m.agency_id === agencyId && m.location_id === locationId && m.idempotency_key === idempotencyKey
          );
          if (existing) {
            return { rows: [], rowCount: 0 };
          }
        }
        const row = {
          id,
          agency_id: agencyId,
          location_id: locationId,
          conversation_id: conversationId,
          contact_id: contactId,
          channel,
          direction,
          sender_type: senderType,
          sender_name: senderName,
          subject,
          body,
          delivery_status: deliveryStatus,
          provider,
          provider_message_id: providerMessageId,
          idempotency_key: idempotencyKey,
          error_code: errorCode,
          metadata: typeof metadata === 'string' ? JSON.parse(metadata) : metadata,
          sent_at: sentAt,
          delivered_at: deliveredAt,
          created_at: '2026-11-25T10:01:00.000Z'
        };
        store.messages.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (normalized.startsWith('SELECT * FROM messages WHERE agency_id = $1 AND location_id = $2 AND provider = $3 AND provider_message_id = $4')) {
        const [agencyId, locationId, provider, providerMessageId] = params;
        const found = store.messages.filter(
          m => m.agency_id === agencyId && m.location_id === locationId && m.provider === provider && m.provider_message_id === providerMessageId
        );
        return { rows: found, rowCount: found.length };
      }

      if (normalized.startsWith('SELECT * FROM messages WHERE agency_id = $1 AND location_id = $2 AND conversation_id = $3')) {
        const [agencyId, locationId, conversationId] = params;
        const found = store.messages.filter(
          m => m.agency_id === agencyId && m.location_id === locationId && m.conversation_id === conversationId
        );
        return { rows: found, rowCount: found.length };
      }

      if (normalized.startsWith('UPDATE conversations SET last_message = $4')) {
        const [agencyId, locationId, id, lastMessage, lastMessageAt] = params;
        const conv = store.conversations.find(c => c.agency_id === agencyId && c.location_id === locationId && c.id === id);
        if (!conv) return { rows: [], rowCount: 0 };
        conv.last_message = lastMessage;
        conv.last_message_at = lastMessageAt;
        conv.updated_at = lastMessageAt;
        return { rows: [conv], rowCount: 1 };
      }

      if (normalized.startsWith('UPDATE messages SET delivery_status =')) {
        const [agencyId, locationId, identifier, status] = params;
        const msg = store.messages.find(
          m => m.agency_id === agencyId && m.location_id === locationId && (m.id === identifier || m.provider_message_id === identifier)
        );
        if (!msg) return { rows: [], rowCount: 0 };
        msg.delivery_status = status;
        if (status === 'delivered') msg.delivered_at = '2026-11-25T10:02:00.000Z';
        return { rows: [msg], rowCount: 1 };
      }

      if (normalized.startsWith('INSERT INTO communication_consents')) {
        const [id, agencyId, locationId, contactId, channel, purpose, status, source, proofRef, capturedAt, expiresAt] = params;
        const row = {
          id,
          agency_id: agencyId,
          location_id: locationId,
          contact_id: contactId,
          channel,
          purpose,
          status,
          source,
          proof_ref: proofRef,
          captured_at: capturedAt,
          expires_at: expiresAt,
          created_at: capturedAt
        };
        store.consents.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (normalized.startsWith('SELECT * FROM communication_consents')) {
        const [agencyId, locationId, contactId] = params;
        let found = store.consents.filter(c => c.agency_id === agencyId && c.location_id === locationId);
        if (contactId && normalized.includes('contact_id =')) {
          found = found.filter(c => c.contact_id === contactId);
        }
        return { rows: [...found].reverse(), rowCount: found.length };
      }

      return { rows: [], rowCount: 0 };
    }
  };
  return tx;
}

test('ConversationsRepository: creates conversation, appends message idempotently on providerMessageId, and updates delivery status', async () => {
  const store = { conversations: [], messages: [], consents: [] };
  const tx = makeMockTx(store);
  const repo = createConversationsRepository();

  const conv = await repo.createConversation(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    contactId: CONTACT_1,
    contactName: 'Jane Doe',
    channel: 'sms',
    subject: 'SMS Thread'
  });

  assert.equal(conv.contactName, 'Jane Doe');
  assert.equal(conv.channel, 'sms');

  const first = await repo.appendMessage(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    conversationId: conv.id,
    contactId: CONTACT_1,
    channel: 'sms',
    direction: 'outbound',
    senderType: 'agent',
    senderName: 'Alice',
    body: 'Hi Jane',
    deliveryStatus: 'queued',
    provider: 'twilio',
    providerMessageId: 'SM-1001'
  });

  assert.equal(first.deduplicated, false);
  assert.equal(first.message.deliveryStatus, 'queued');

  const duplicate = await repo.appendMessage(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    conversationId: conv.id,
    contactId: CONTACT_1,
    channel: 'sms',
    direction: 'outbound',
    senderType: 'agent',
    senderName: 'Alice',
    body: 'Hi Jane',
    deliveryStatus: 'queued',
    provider: 'twilio',
    providerMessageId: 'SM-1001'
  });

  assert.equal(duplicate.deduplicated, true);
  assert.equal(store.messages.length, 1);

  const updated = await repo.updateMessageDeliveryStatus(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    providerMessageId: 'SM-1001',
    deliveryStatus: 'delivered'
  });

  assert.equal(updated.deliveryStatus, 'delivered');
});

test('CommunicationConsentsRepository: enforces channel isolation, opt-in, and STOP revocation suppression', async () => {
  const store = { conversations: [], messages: [], consents: [] };
  const tx = makeMockTx(store);
  const consentsRepo = createCommunicationConsentsRepository();

  // Default state: no consent recorded -> transactional allowed only if not revoked, marketing requires grant
  const initialCheck = await consentsRepo.isChannelAllowed(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    contactId: CONTACT_1,
    channel: 'sms',
    purpose: 'marketing'
  });
  assert.equal(initialCheck.allowed, false);

  await consentsRepo.recordConsent(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    contactId: CONTACT_1,
    channel: 'sms',
    purpose: 'marketing',
    status: 'granted',
    source: 'web_form',
    proofRef: 'form-123'
  });

  const grantedCheck = await consentsRepo.isChannelAllowed(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    contactId: CONTACT_1,
    channel: 'sms',
    purpose: 'marketing'
  });
  assert.equal(grantedCheck.allowed, true);

  // Revoke SMS via STOP keyword -> SMS suppressed, Email unaffected
  await consentsRepo.recordConsent(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    contactId: CONTACT_1,
    channel: 'sms',
    purpose: 'marketing',
    status: 'revoked',
    source: 'keyword_opt_out',
    proofRef: 'STOP'
  });

  const revokedSms = await consentsRepo.isChannelAllowed(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    contactId: CONTACT_1,
    channel: 'sms',
    purpose: 'transactional'
  });
  assert.equal(revokedSms.allowed, false);
  assert.equal(revokedSms.reason, 'consent_revoked');

  const emailCheck = await consentsRepo.isChannelAllowed(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    contactId: CONTACT_1,
    channel: 'email',
    purpose: 'transactional'
  });
  assert.equal(emailCheck.allowed, true);
});
