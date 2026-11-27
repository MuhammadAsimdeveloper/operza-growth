/**
 * ============================================================================
 * Operza Messaging, Conversations & Communication Consents Router
 * ============================================================================
 * Handles:
 * - /api/crm/conversations and /api/crm/conversations/:id
 * - /api/conversations/:id/messages (with pre-dispatch consent check)
 * - /api/platform/consents and /api/platform/consents/:id/revoke
 */

import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createConversationsRepository } from '../../../packages/db/lib/conversations-repository.mjs';
import { createCommunicationConsentsRepository } from '../../../packages/db/lib/communication-consents-repository.mjs';
import { recordConsent } from '../../../packages/platform-core/src/consent-policy.mjs';
import { handleEngagement2Routes } from './engagement2.mjs';
import { handleSupport2Routes } from './support2.mjs';

const conversationsRepo = createConversationsRepository();
const consentsRepo = createCommunicationConsentsRepository();

const CONSENT_CHANNELS = new Set(['email', 'sms', 'whatsapp']);

function checkScope(actor, requiredScope, alternativeScopes = []) {
  if (!actor || !actor.apiKey) return true;
  const scopes = actor.scopes || [];
  if (scopes.includes('*') || scopes.includes('all')) return true;
  if (scopes.includes(requiredScope)) return true;
  return alternativeScopes.some(alt => scopes.includes(alt));
}

function stripTenantFields(body) {
  if (!body || typeof body !== 'object') return {};
  const { agencyId: _a, locationId: _l, ...rest } = body;
  return rest;
}

function evaluateInMemoryConsent(state, { agencyId, locationId, contactId, channel, purpose = 'transactional' }) {
  if (!contactId || !CONSENT_CHANNELS.has(channel)) {
    return { allowed: true, reason: 'untracked_channel_or_contact' };
  }
  const records = [
    ...(state.records?.communicationConsents || []),
    ...(state.communicationConsents || [])
  ]
    .filter(c => (c.agencyId === agencyId || c.tenantId === agencyId) && c.locationId === locationId && c.contactId === contactId && c.channel === channel)
    .sort((a, b) => String(b.capturedAt || b.createdAt || '').localeCompare(String(a.capturedAt || a.createdAt || '')));

  if (records.length === 0) {
    if (purpose === 'marketing') {
      return { allowed: false, reason: 'marketing_opt_in_required' };
    }
    return { allowed: true, reason: 'no_revocation_recorded' };
  }

  const latest = records[0];
  if (latest.status === 'revoked') {
    return { allowed: false, reason: 'consent_revoked', record: latest };
  }
  const byPurpose = records.find(r => r.purpose === purpose) || latest;
  if (byPurpose.status === 'revoked') {
    return { allowed: false, reason: 'consent_revoked', record: byPurpose };
  }
  if (byPurpose.expiresAt && new Date(byPurpose.expiresAt).getTime() <= Date.now()) {
    return { allowed: false, reason: 'consent_expired', record: byPurpose };
  }
  return { allowed: true, reason: 'consent_granted', record: byPurpose };
}

export async function recordInboundOptOut({
  pgPool,
  state,
  agencyId,
  locationId,
  actorId = 'webhook',
  contactId,
  channel = 'sms',
  proofRef = 'STOP',
  randomUUID
}) {
  if (!contactId || !agencyId || !locationId) return null;
  if (pgPool) {
    return runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
      consentsRepo.recordConsent(tx, {
        agencyId,
        locationId,
        contactId,
        channel,
        purpose: 'transactional',
        status: 'revoked',
        source: 'keyword_opt_out',
        proofRef
      })
    );
  }
  state.records.communicationConsents = state.records.communicationConsents || [];
  const rec = recordConsent(
    {
      tenantId: agencyId,
      locationId,
      contactId,
      channel,
      purpose: 'transactional',
      status: 'revoked',
      source: 'keyword_opt_out',
      proofRef
    },
    { id: randomUUID ? randomUUID() : undefined }
  );
  const stored = { ...rec, agencyId };
  state.records.communicationConsents.push(stored);
  return stored;
}

export async function handleConversationsRoutes(req, res, ctx) {
  const {
    method,
    pathname,
    url,
    readBody,
    sendJson,
    state,
    saveState,
    auditLog,
    broadcast,
    actor,
    agency,
    activeLocation,
    pgPool,
    randomUUID
  } = ctx;

  const agencyId = agency?.id;
  const locationId = activeLocation?.id;
  const actorId = actor?.user?.id || 'system';
  const queryUrl = url || new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);

  if (await handleEngagement2Routes({ req, res, pathname, method, ctx })) {
    return true;
  }
  if (await handleSupport2Routes({ req, res, pathname, method, ctx })) {
    return true;
  }

  // ── 1. /api/crm/conversations CRUD ────────────────────────────────────────
  if (pathname === '/api/crm/conversations' || pathname.startsWith('/api/crm/conversations/')) {
    const convId = pathname === '/api/crm/conversations'
      ? null
      : pathname.replace('/api/crm/conversations/', '').trim();

    if (method === 'GET' && !convId) {
      if (!checkScope(actor, 'conversations:read', ['crm:read'])) {
        sendJson(res, 403, { error: 'Insufficient API key scope (conversations:read required)' });
        return true;
      }
      const channel = queryUrl.searchParams.get('channel') || null;
      const status = queryUrl.searchParams.get('status') || null;
      const contactId = queryUrl.searchParams.get('contactId') || null;

      if (pgPool) {
        const rows = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
          conversationsRepo.listConversations(tx, { agencyId, locationId, contactId, channel, status })
        );
        sendJson(res, 200, { data: rows, conversations: rows, total: rows.length });
        return true;
      }

      state.records.conversations = state.records.conversations || [];
      let rows = state.records.conversations.filter(
        c => c.agencyId === agencyId && c.locationId === locationId
      );
      if (channel) rows = rows.filter(c => c.channel === channel);
      if (status) rows = rows.filter(c => c.status === status);
      if (contactId) rows = rows.filter(c => c.contactId === contactId);
      sendJson(res, 200, { data: rows, conversations: rows, total: rows.length });
      return true;
    }

    if (method === 'POST' && !convId) {
      if (!checkScope(actor, 'conversations:write', ['crm:write'])) {
        sendJson(res, 403, { error: 'Insufficient API key scope (conversations:write required)' });
        return true;
      }
      const rawBody = await readBody(req);
      const body = stripTenantFields(rawBody);
      if (!body.contactName && !body.contactId) {
        sendJson(res, 400, { error: 'contactName or contactId is required' });
        return true;
      }

      let conv;
      if (pgPool) {
        conv = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
          conversationsRepo.createConversation(tx, {
            ...body,
            agencyId,
            locationId
          })
        );
      } else {
        state.records.conversations = state.records.conversations || [];
        conv = {
          id: randomUUID(),
          agencyId,
          locationId,
          contactId: body.contactId || null,
          contactName: body.contactName || 'Unknown Contact',
          channel: body.channel || 'sms',
          subject: body.subject || null,
          status: body.status || 'open',
          assignedTo: body.assignedTo || null,
          lastMessage: body.lastMessage || '',
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.records.conversations.push(conv);
        await saveState();
      }

      auditLog?.('conversation.created', actor, { convId: conv.id, channel: conv.channel });
      broadcast?.('crm.conversation.created', { id: conv.id, channel: conv.channel });
      sendJson(res, 201, conv);
      return true;
    }

    if (method === 'GET' && convId) {
      if (!checkScope(actor, 'conversations:read', ['crm:read'])) {
        sendJson(res, 403, { error: 'Insufficient API key scope (conversations:read required)' });
        return true;
      }
      let conv;
      if (pgPool) {
        conv = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
          conversationsRepo.getConversation(tx, { agencyId, locationId, id: convId, includeMessages: true })
        );
      } else {
        conv = (state.records.conversations || []).find(
          c => c.id === convId && c.agencyId === agencyId && c.locationId === locationId
        );
      }
      if (!conv) {
        sendJson(res, 404, { error: 'Conversation not found' });
        return true;
      }
      sendJson(res, 200, conv);
      return true;
    }

    if ((method === 'PATCH' || method === 'PUT') && convId) {
      if (!checkScope(actor, 'conversations:write', ['crm:write'])) {
        sendJson(res, 403, { error: 'Insufficient API key scope (conversations:write required)' });
        return true;
      }
      const body = stripTenantFields(await readBody(req));
      let updated;
      if (pgPool) {
        updated = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
          conversationsRepo.updateConversation(tx, { agencyId, locationId, id: convId, patch: body })
        );
      } else {
        const conv = (state.records.conversations || []).find(
          c => c.id === convId && c.agencyId === agencyId && c.locationId === locationId
        );
        if (conv) {
          if (body.status) conv.status = body.status;
          if (body.channel) conv.channel = body.channel;
          if (body.assignedTo !== undefined) conv.assignedTo = body.assignedTo;
          if (body.subject !== undefined) conv.subject = body.subject;
          conv.updatedAt = new Date().toISOString();
          await saveState();
          updated = conv;
        }
      }
      if (!updated) {
        sendJson(res, 404, { error: 'Conversation not found' });
        return true;
      }
      auditLog?.('conversation.updated', actor, { convId });
      sendJson(res, 200, updated);
      return true;
    }

    if (method === 'DELETE' && convId) {
      if (!checkScope(actor, 'conversations:write', ['crm:write'])) {
        sendJson(res, 403, { error: 'Insufficient API key scope (conversations:write required)' });
        return true;
      }
      let deleted = false;
      if (pgPool) {
        deleted = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
          conversationsRepo.deleteConversation(tx, { agencyId, locationId, id: convId })
        );
      } else {
        state.records.conversations = state.records.conversations || [];
        const idx = state.records.conversations.findIndex(
          c => c.id === convId && c.agencyId === agencyId && c.locationId === locationId
        );
        if (idx !== -1) {
          state.records.conversations.splice(idx, 1);
          await saveState();
          deleted = true;
        }
      }
      if (!deleted) {
        sendJson(res, 404, { error: 'Conversation not found' });
        return true;
      }
      auditLog?.('conversation.deleted', actor, { convId });
      sendJson(res, 200, { success: true, id: convId });
      return true;
    }
  }

  // ── 2. /api/conversations/:id/messages ────────────────────────────────────
  if (pathname.startsWith('/api/conversations/') && pathname.endsWith('/messages')) {
    const convId = pathname.replace('/api/conversations/', '').replace('/messages', '').trim();

    if (method === 'GET') {
      if (!checkScope(actor, 'conversations:read', ['crm:read'])) {
        sendJson(res, 403, { error: 'Insufficient API key scope (conversations:read required)' });
        return true;
      }
      if (pgPool) {
        const conv = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
          conversationsRepo.getConversation(tx, { agencyId, locationId, id: convId, includeMessages: true })
        );
        if (!conv) {
          sendJson(res, 404, { error: 'Conversation not found' });
          return true;
        }
        sendJson(res, 200, { messages: conv.messages || [] });
        return true;
      }
      const conv = (state.records.conversations || []).find(
        c => c.id === convId && c.agencyId === agencyId && c.locationId === locationId
      );
      if (!conv) {
        sendJson(res, 404, { error: 'Conversation not found' });
        return true;
      }
      sendJson(res, 200, { messages: conv.messages || [] });
      return true;
    }

    if (method === 'POST') {
      if (!checkScope(actor, 'conversations:write', ['crm:write'])) {
        sendJson(res, 403, { error: 'Insufficient API key scope (conversations:write required)' });
        return true;
      }

      const body = stripTenantFields(await readBody(req));
      const text = body.content || body.body || '';
      if (!text) {
        sendJson(res, 400, { error: 'content is required' });
        return true;
      }

      if (pgPool) {
        const result = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, async tx => {
          const conv = await conversationsRepo.getConversation(tx, {
            agencyId,
            locationId,
            id: convId,
            includeMessages: false
          });
          if (!conv) return { notFound: true };

          const channel = body.channel || conv.channel || 'sms';
          const purpose = body.purpose || 'transactional';
          const consentCheck = await consentsRepo.isChannelAllowed(tx, {
            agencyId,
            locationId,
            contactId: conv.contactId,
            channel,
            purpose
          });
          if (!consentCheck.allowed) {
            return { blocked: true, consentCheck };
          }

          const appended = await conversationsRepo.appendMessage(tx, {
            agencyId,
            locationId,
            conversationId: conv.id,
            contactId: conv.contactId,
            channel,
            direction: 'outbound',
            senderType: 'agent',
            senderName: actor?.user?.name || 'Agent',
            subject: body.subject || null,
            body: text,
            deliveryStatus: 'queued',
            idempotencyKey: body.idempotencyKey || null
          });
          const refreshed = await conversationsRepo.getConversation(tx, {
            agencyId,
            locationId,
            id: conv.id,
            includeMessages: true
          });
          return { conv: refreshed, message: appended.message, deduplicated: appended.deduplicated };
        });

        if (result.notFound) {
          sendJson(res, 404, { error: 'Conversation not found' });
          return true;
        }
        if (result.blocked) {
          sendJson(res, 403, {
            error: `Outbound ${body.channel || 'channel'} blocked by communication consent (${result.consentCheck.reason})`,
            code: 'ConsentRevoked',
            reason: result.consentCheck.reason
          });
          return true;
        }

        auditLog?.('conversation.message_sent', actor, { convId, channel: result.message.channel });
        broadcast?.('crm.conversation.message', { conversationId: convId, message: result.message });
        sendJson(res, 201, {
          success: true,
          deduplicated: result.deduplicated,
          message: result.message,
          conversation: result.conv
        });
        return true;
      }

      state.records.conversations = state.records.conversations || [];
      const conv = state.records.conversations.find(
        c => c.id === convId && c.agencyId === agencyId && c.locationId === locationId
      );
      if (!conv) {
        sendJson(res, 404, { error: 'Conversation not found' });
        return true;
      }

      const channel = body.channel || conv.channel || 'sms';
      const purpose = body.purpose || 'transactional';
      const consentCheck = evaluateInMemoryConsent(state, {
        agencyId,
        locationId,
        contactId: conv.contactId,
        channel,
        purpose
      });
      if (!consentCheck.allowed) {
        sendJson(res, 403, {
          error: `Outbound ${channel} blocked by communication consent (${consentCheck.reason})`,
          code: 'ConsentRevoked',
          reason: consentCheck.reason
        });
        return true;
      }

      const msg = {
        id: randomUUID(),
        sender: 'agent',
        senderType: 'agent',
        senderName: actor?.user?.name || 'Agent',
        channel,
        direction: 'outbound',
        content: text,
        body: text,
        subject: body.subject || undefined,
        deliveryStatus: 'queued',
        timestamp: new Date().toISOString()
      };

      conv.messages = conv.messages || [];
      conv.messages.push(msg);
      conv.lastMessage = text;
      conv.updatedAt = new Date().toISOString();
      await saveState();

      auditLog?.('conversation.message_sent', actor, { convId, channel: msg.channel });
      broadcast?.('crm.conversation.message', { conversationId: conv.id, message: msg });
      sendJson(res, 201, { success: true, message: msg, conversation: conv });
      return true;
    }
  }

  // ── 3. /api/platform/consents & /api/platform/consents/:id/revoke ─────────
  if (method === 'GET' && pathname === '/api/platform/consents') {
    if (!checkScope(actor, 'consents:read', ['conversations:read', 'crm:read'])) {
      sendJson(res, 403, { error: 'Insufficient API key scope (consents:read required)' });
      return true;
    }
    const contactId = queryUrl.searchParams.get('contactId') || undefined;
    if (pgPool) {
      const consents = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
        consentsRepo.listConsents(tx, { agencyId, locationId, contactId })
      );
      sendJson(res, 200, { data: consents, consents });
      return true;
    }
    const items = [
      ...(state.records?.communicationConsents || []),
      ...(state.communicationConsents || [])
    ].filter(
      c => (c.agencyId === agencyId || c.tenantId === agencyId) && c.locationId === locationId && (!contactId || c.contactId === contactId)
    );
    sendJson(res, 200, { data: items, consents: items });
    return true;
  }

  if (method === 'POST' && pathname === '/api/platform/consents') {
    if (!checkScope(actor, 'consents:write', ['conversations:write', 'crm:write'])) {
      sendJson(res, 403, { error: 'Insufficient API key scope (consents:write required)' });
      return true;
    }
    const role = actor?.membership?.role || actor?.user?.role || '';
    if (!['owner', 'admin'].includes(role)) {
      sendJson(res, 403, { error: 'Only workspace owners and admins can record consent evidence' });
      return true;
    }

    const body = stripTenantFields(await readBody(req));
    const contact = (state.records?.contacts || []).find(
      c => c.id === body.contactId && c.agencyId === agencyId
    );
    if (!pgPool && !contact) {
      sendJson(res, 404, { error: 'Contact not found in the active workspace' });
      return true;
    }
    if (body.status === 'granted' && (typeof body.proofRef !== 'string' || body.proofRef.trim().length < 3)) {
      sendJson(res, 400, {
        error: 'Granting consent requires an auditable proof reference',
        code: 'CONSENT_PROOF_REQUIRED'
      });
      return true;
    }

    try {
      let stored;
      if (pgPool) {
        stored = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
          consentsRepo.recordConsent(tx, { ...body, agencyId, locationId })
        );
      } else {
        const consent = recordConsent(
          { ...body, tenantId: agencyId, locationId },
          { id: randomUUID() }
        );
        consent.capturedByActorId = actorId;
        state.records.communicationConsents = state.records.communicationConsents || [];
        state.communicationConsents = state.communicationConsents || [];
        stored = { ...consent, agencyId };
        state.records.communicationConsents.push(stored);
        state.communicationConsents.push(stored);
        await saveState();
      }
      auditLog?.('communication.consent.recorded', actor, {
        consentId: stored.id,
        contactId: stored.contactId,
        channel: stored.channel,
        status: stored.status
      });
      sendJson(res, 201, { success: true, consent: stored });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/api/platform/consents/') && pathname.endsWith('/revoke')) {
    if (!checkScope(actor, 'consents:write', ['conversations:write', 'crm:write'])) {
      sendJson(res, 403, { error: 'Insufficient API key scope (consents:write required)' });
      return true;
    }
    const role = actor?.membership?.role || actor?.user?.role || '';
    if (!['owner', 'admin'].includes(role)) {
      sendJson(res, 403, { error: 'Only workspace owners and admins can record opt-outs' });
      return true;
    }

    const consentId = pathname.replace('/api/platform/consents/', '').replace('/revoke', '').trim();
    const body = stripTenantFields(await readBody(req));

    let revoked;
    if (pgPool) {
      revoked = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
        consentsRepo.revokeConsent(tx, {
          agencyId,
          locationId,
          consentId,
          source: body.source || 'manual',
          proofRef: body.proofRef || ('operator:' + actorId)
        })
      );
    } else {
      state.records.communicationConsents = state.records.communicationConsents || [];
      state.communicationConsents = state.communicationConsents || [];
      const existing = [...state.records.communicationConsents, ...state.communicationConsents].find(
        c => c.id === consentId && (c.agencyId === agencyId || c.tenantId === agencyId) && c.locationId === locationId
      );
      if (existing) {
        const rec = recordConsent(
          {
            tenantId: agencyId,
            locationId,
            contactId: existing.contactId,
            channel: existing.channel,
            purpose: existing.purpose,
            status: 'revoked',
            source: body.source || 'manual',
            proofRef: body.proofRef || ('operator:' + actorId)
          },
          { id: randomUUID() }
        );
        rec.capturedByActorId = actorId;
        revoked = { ...rec, agencyId };
        state.records.communicationConsents.push(revoked);
        state.communicationConsents.push(revoked);
        await saveState();
      }
    }

    if (!revoked) {
      sendJson(res, 404, { error: 'Consent record not found' });
      return true;
    }

    auditLog?.('communication.consent.revoked', actor, {
      consentId: revoked.id,
      priorConsentId: consentId,
      contactId: revoked.contactId,
      channel: revoked.channel
    });
    sendJson(res, 200, { success: true, consent: revoked });
    return true;
  }

  return false;
}
