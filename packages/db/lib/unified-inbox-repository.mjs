/**
 * ============================================================================
 * Operza Unified Inbox & Customer Support 2.0 Repository — TenantTx Boundary
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import {
  assertValidSupportTransition,
  computeSlaDeadlines,
  evaluateSlaStatus,
  validateSavedReplyTemplate
} from '../../platform-core/src/unified-inbox-2-0.mjs';

function parseJson(val, fallback) {
  if (val == null) return fallback;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return val;
}

function iso(val) {
  return val?.toISOString?.() || val || null;
}

export function normalizeInboxConversation(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    contactId: row.contact_id || null,
    contactName: row.contact_name || 'Unknown Contact',
    channel: row.channel || 'webchat',
    subject: row.subject || null,
    status: row.status || 'open',
    priority: row.priority || 'normal',
    tags: parseJson(row.tags, []),
    unreadCount: Number(row.unread_count) || 0,
    assignedTo: row.assigned_to || null,
    assignedAgentName: row.assigned_agent_name || null,
    teamId: row.team_id || null,
    lastMessage: row.last_message || '',
    lastMessageAt: iso(row.last_message_at),
    firstResponseAt: iso(row.first_response_at),
    resolvedAt: iso(row.resolved_at),
    closedAt: iso(row.closed_at),
    slaPolicyId: row.sla_policy_id || null,
    slaFirstResponseDueAt: iso(row.sla_first_response_due_at),
    slaNextResponseDueAt: iso(row.sla_next_response_due_at),
    slaResolutionDueAt: iso(row.sla_resolution_due_at),
    slaPausedAt: iso(row.sla_paused_at),
    slaBreached: Boolean(row.sla_breached),
    slaStatus: row.sla_status || 'none',
    version: Number(row.version) || 1,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

export function normalizeTicketRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    conversationId: row.conversation_id || null,
    contactId: row.contact_id || null,
    opportunityId: row.opportunity_id || null,
    appointmentId: row.appointment_id || null,
    subject: row.subject,
    description: row.description || '',
    status: row.status,
    priority: row.priority,
    category: row.category || 'general',
    assignedTo: row.assigned_to || null,
    teamId: row.team_id || null,
    resolutionSummary: row.resolution_summary || null,
    resolvedAt: iso(row.resolved_at),
    closedAt: iso(row.closed_at),
    reopenedCount: Number(row.reopened_count) || 0,
    version: Number(row.version) || 1,
    createdBy: row.created_by || null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

export function createUnifiedInboxRepository() {
  return {
    async listInboxConversations(tx, filters = {}) {
      const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
      const offset = Math.max(0, Number(filters.offset) || 0);
      const clauses = ['c.agency_id = $1', 'c.location_id = $2'];
      const params = [tx.agencyId, tx.locationId];
      let idx = 3;

      const view = filters.view || 'all';
      if (view === 'assigned_to_me' && filters.actorId) {
        clauses.push(`c.assigned_to = $${idx++}`);
        params.push(filters.actorId);
      } else if (view === 'unassigned') {
        clauses.push(`(c.assigned_to IS NULL OR c.assigned_to = '')`);
      } else if (['open', 'pending', 'waiting_on_customer', 'waiting_on_internal', 'resolved', 'closed'].includes(view)) {
        clauses.push(`c.status = $${idx++}`);
        params.push(view);
      } else if (view === 'high_priority') {
        clauses.push(`c.priority IN ('high', 'urgent')`);
      } else if (view === 'overdue_sla') {
        clauses.push(`(c.sla_breached = true OR c.sla_status = 'breached')`);
      } else if (view === 'team_queue' && filters.teamId) {
        clauses.push(`c.team_id = $${idx++}`);
        params.push(filters.teamId);
      }

      if (filters.status && filters.status !== 'all') {
        clauses.push(`c.status = $${idx++}`);
        params.push(filters.status);
      }
      if (filters.priority && filters.priority !== 'all') {
        clauses.push(`c.priority = $${idx++}`);
        params.push(filters.priority);
      }
      if (filters.channel && filters.channel !== 'all') {
        clauses.push(`c.channel = $${idx++}`);
        params.push(filters.channel);
      }
      if (filters.teamId && filters.teamId !== 'all') {
        clauses.push(`c.team_id = $${idx++}`);
        params.push(filters.teamId);
      }
      if (filters.assignedTo && filters.assignedTo !== 'all') {
        clauses.push(`c.assigned_to = $${idx++}`);
        params.push(filters.assignedTo);
      }
      if (filters.slaStatus && filters.slaStatus !== 'all') {
        clauses.push(`c.sla_status = $${idx++}`);
        params.push(filters.slaStatus);
      }
      if (filters.tag) {
        clauses.push(`c.tags @> $${idx++}::jsonb`);
        params.push(JSON.stringify([filters.tag]));
      }
      if (filters.search) {
        const q = `%${String(filters.search).trim()}%`;
        clauses.push(`(
          c.contact_name ILIKE $${idx}
          OR COALESCE(c.subject, '') ILIKE $${idx}
          OR COALESCE(c.last_message, '') ILIKE $${idx}
          OR EXISTS (
            SELECT 1 FROM support_tickets st
            WHERE st.agency_id = c.agency_id AND st.location_id = c.location_id
              AND st.conversation_id = c.id AND st.ticket_number ILIKE $${idx}
          )
        )`);
        params.push(q);
        idx++;
      }

      const whereSql = clauses.join(' AND ');
      const countRes = await tx.query(`SELECT COUNT(*)::int AS total FROM conversations c WHERE ${whereSql}`, params);
      const listRes = await tx.query(
        `SELECT c.* FROM conversations c
         WHERE ${whereSql}
         ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      return {
        items: listRes.rows.map(normalizeInboxConversation),
        total: countRes.rows[0]?.total || 0,
        limit,
        offset
      };
    },

    async getInboxConversationDetail(tx, { conversationId, includeInternalNotes = true }) {
      const convRes = await tx.query(
        `SELECT * FROM conversations WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [tx.agencyId, tx.locationId, conversationId]
      );
      if (convRes.rows.length === 0) return null;
      const conversation = normalizeInboxConversation(convRes.rows[0]);

      const msgRes = await tx.query(
        `SELECT * FROM messages
         WHERE agency_id = $1 AND location_id = $2 AND conversation_id = $3
         ORDER BY created_at ASC`,
        [tx.agencyId, tx.locationId, conversationId]
      );

      let notes = [];
      if (includeInternalNotes) {
        const notesRes = await tx.query(
          `SELECT * FROM engagement_conversation_notes
           WHERE agency_id = $1 AND location_id = $2 AND conversation_id = $3
           ORDER BY created_at ASC`,
          [tx.agencyId, tx.locationId, conversationId]
        );
        notes = notesRes.rows.map(n => ({
          id: n.id,
          conversationId: n.conversation_id,
          authorId: n.author_id,
          authorName: n.author_name || 'Agent',
          body: n.body,
          isInternal: true,
          createdAt: iso(n.created_at)
        }));
      }

      const histRes = await tx.query(
        `SELECT * FROM engagement_conversation_history
         WHERE agency_id = $1 AND location_id = $2 AND conversation_id = $3
         ORDER BY created_at DESC LIMIT 100`,
        [tx.agencyId, tx.locationId, conversationId]
      );

      const ticketRes = await tx.query(
        `SELECT * FROM support_tickets
         WHERE agency_id = $1 AND location_id = $2 AND conversation_id = $3
         ORDER BY created_at DESC`,
        [tx.agencyId, tx.locationId, conversationId]
      );

      const slaPolicy = conversation.slaPolicyId
        ? (await tx.query(
            `SELECT * FROM sla_policies WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
            [tx.agencyId, tx.locationId, conversation.slaPolicyId]
          )).rows[0] || null
        : null;

      return {
        conversation: {
          ...conversation,
          slaEvaluation: evaluateSlaStatus({ conversation, policy: slaPolicy })
        },
        messages: msgRes.rows.map(m => ({
          id: m.id,
          conversationId: m.conversation_id,
          contactId: m.contact_id || null,
          channel: m.channel,
          direction: m.direction,
          senderType: m.sender_type,
          senderName: m.sender_name || null,
          subject: m.subject || null,
          body: m.body,
          deliveryStatus: m.delivery_status,
          provider: m.provider || null,
          providerMessageId: m.provider_message_id || null,
          errorCode: m.error_code || null,
          createdAt: iso(m.created_at)
        })),
        internalNotes: notes,
        history: histRes.rows.map(h => ({
          id: h.id,
          actorId: h.actor_id,
          eventType: h.event_type,
          fromValue: h.from_value,
          toValue: h.to_value,
          metadata: parseJson(h.metadata, {}),
          createdAt: iso(h.created_at)
        })),
        tickets: ticketRes.rows.map(normalizeTicketRow)
      };
    },

    async assignConversation(tx, {
      conversationId,
      assignedTo = null,
      assignedAgentName = null,
      teamId = undefined,
      expectedVersion = undefined,
      actorId = 'system'
    }) {
      const lockRes = await tx.query(
        `SELECT * FROM conversations WHERE agency_id = $1 AND location_id = $2 AND id = $3 FOR UPDATE`,
        [tx.agencyId, tx.locationId, conversationId]
      );
      if (lockRes.rows.length === 0) return { notFound: true, code: 'CONVERSATION_NOT_FOUND' };
      const cur = lockRes.rows[0];
      if (expectedVersion !== undefined && Number(cur.version) !== Number(expectedVersion)) {
        return { conflict: true, code: 'ASSIGNMENT_VERSION_CONFLICT', error: 'Conversation was modified by another agent.' };
      }

      const nextTeamId = teamId !== undefined ? teamId : cur.team_id;
      const upd = await tx.query(
        `UPDATE conversations
         SET assigned_to = $1,
             assigned_agent_name = $2,
             team_id = $3,
             version = version + 1,
             updated_at = now()
         WHERE agency_id = $4 AND location_id = $5 AND id = $6
         RETURNING *`,
        [assignedTo, assignedAgentName, nextTeamId, tx.agencyId, tx.locationId, conversationId]
      );

      await tx.query(
        `INSERT INTO engagement_conversation_history (
          id, agency_id, location_id, conversation_id, actor_id, event_type, from_value, to_value, metadata
        ) VALUES ($1, $2, $3, $4, $5, 'assignment_changed', $6, $7, $8::jsonb)`,
        [
          randomUUID(),
          tx.agencyId,
          tx.locationId,
          conversationId,
          actorId,
          cur.assigned_to || 'unassigned',
          assignedTo || 'unassigned',
          JSON.stringify({ fromTeamId: cur.team_id || null, toTeamId: nextTeamId || null })
        ]
      );

      return { success: true, conversation: normalizeInboxConversation(upd.rows[0]) };
    },

    async updateConversationLifecycle(tx, {
      conversationId,
      status = undefined,
      priority = undefined,
      tags = undefined,
      expectedVersion = undefined,
      actorId = 'system'
    }) {
      const lockRes = await tx.query(
        `SELECT * FROM conversations WHERE agency_id = $1 AND location_id = $2 AND id = $3 FOR UPDATE`,
        [tx.agencyId, tx.locationId, conversationId]
      );
      if (lockRes.rows.length === 0) return { notFound: true, code: 'CONVERSATION_NOT_FOUND' };
      const cur = lockRes.rows[0];
      if (expectedVersion !== undefined && Number(cur.version) !== Number(expectedVersion)) {
        return { conflict: true, code: 'VERSION_CONFLICT', error: 'Conversation was modified concurrently.' };
      }

      const nextStatus = status ?? cur.status;
      assertValidSupportTransition('conversation', cur.status, nextStatus);
      const nextPriority = priority ?? cur.priority;
      const nextTags = Array.isArray(tags) ? tags : parseJson(cur.tags, []);

      const upd = await tx.query(
        `UPDATE conversations
         SET status = $1,
             priority = $2,
             tags = $3::jsonb,
             resolved_at = CASE WHEN $1 = 'resolved' THEN COALESCE(resolved_at, now()) WHEN $1 = 'open' THEN NULL ELSE resolved_at END,
             closed_at = CASE WHEN $1 = 'closed' THEN COALESCE(closed_at, now()) WHEN $1 = 'open' THEN NULL ELSE closed_at END,
             sla_paused_at = CASE WHEN $1 = 'waiting_on_customer' THEN COALESCE(sla_paused_at, now()) ELSE NULL END,
             sla_status = CASE WHEN $1 IN ('resolved','closed') THEN 'completed' WHEN $1 = 'waiting_on_customer' THEN 'paused' ELSE sla_status END,
             version = version + 1,
             updated_at = now()
         WHERE agency_id = $4 AND location_id = $5 AND id = $6
         RETURNING *`,
        [nextStatus, nextPriority, JSON.stringify(nextTags), tx.agencyId, tx.locationId, conversationId]
      );

      if (status && status !== cur.status) {
        await tx.query(
          `INSERT INTO engagement_conversation_history (
            id, agency_id, location_id, conversation_id, actor_id, event_type, from_value, to_value
          ) VALUES ($1, $2, $3, $4, $5, 'status_changed', $6, $7)`,
          [randomUUID(), tx.agencyId, tx.locationId, conversationId, actorId, cur.status, nextStatus]
        );
      }
      if (priority && priority !== cur.priority) {
        await tx.query(
          `INSERT INTO engagement_conversation_history (
            id, agency_id, location_id, conversation_id, actor_id, event_type, from_value, to_value
          ) VALUES ($1, $2, $3, $4, $5, 'priority_changed', $6, $7)`,
          [randomUUID(), tx.agencyId, tx.locationId, conversationId, actorId, cur.priority, nextPriority]
        );
      }

      return { success: true, conversation: normalizeInboxConversation(upd.rows[0]) };
    },

    async addInternalNote(tx, { conversationId, authorId, authorName = 'Agent', body }) {
      const text = String(body || '').trim();
      if (!text) throw Object.assign(new Error('Internal note body is required'), { code: 'INVALID_INPUT', status: 400 });
      const res = await tx.query(
        `INSERT INTO engagement_conversation_notes (
          id, agency_id, location_id, conversation_id, author_id, author_name, body
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [randomUUID(), tx.agencyId, tx.locationId, conversationId, authorId, authorName, text]
      );
      return {
        id: res.rows[0].id,
        conversationId: res.rows[0].conversation_id,
        authorId: res.rows[0].author_id,
        authorName: res.rows[0].author_name,
        body: res.rows[0].body,
        isInternal: true,
        createdAt: iso(res.rows[0].created_at)
      };
    },

    async addPublicReply(tx, {
      conversationId,
      body,
      subject = null,
      channel = null,
      senderName = 'Support Agent',
      deliveryStatus = 'queued',
      provider = null,
      idempotencyKey = null
    }) {
      const text = String(body || '').trim();
      if (!text) throw Object.assign(new Error('Reply body is required'), { code: 'INVALID_INPUT', status: 400 });

      const convRes = await tx.query(
        `SELECT * FROM conversations WHERE agency_id = $1 AND location_id = $2 AND id = $3 FOR UPDATE`,
        [tx.agencyId, tx.locationId, conversationId]
      );
      if (convRes.rows.length === 0) return { notFound: true, code: 'CONVERSATION_NOT_FOUND' };
      const conv = convRes.rows[0];

      if (idempotencyKey) {
        const dup = await tx.query(
          `SELECT * FROM messages WHERE agency_id = $1 AND location_id = $2 AND idempotency_key = $3`,
          [tx.agencyId, tx.locationId, idempotencyKey]
        );
        if (dup.rows.length > 0) {
          return { success: true, deduplicated: true, message: dup.rows[0], conversation: normalizeInboxConversation(conv) };
        }
      }

      const msgId = randomUUID();
      const msgRes = await tx.query(
        `INSERT INTO messages (
          id, agency_id, location_id, conversation_id, contact_id, channel, direction,
          sender_type, sender_name, subject, body, delivery_status, provider, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, 'outbound', 'agent', $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          msgId, tx.agencyId, tx.locationId, conversationId, conv.contact_id,
          channel || conv.channel, senderName, subject, text, deliveryStatus, provider, idempotencyKey
        ]
      );

      const updConv = await tx.query(
        `UPDATE conversations
         SET last_message = $1,
             last_message_at = now(),
             last_outbound_at = now(),
             first_response_at = COALESCE(first_response_at, now()),
             unread_count = 0,
             updated_at = now()
         WHERE agency_id = $2 AND location_id = $3 AND id = $4
         RETURNING *`,
        [text.slice(0, 500), tx.agencyId, tx.locationId, conversationId]
      );

      return { success: true, deduplicated: false, message: msgRes.rows[0], conversation: normalizeInboxConversation(updConv.rows[0]) };
    },

    async ingestInboundMessage(tx, {
      conversationId,
      contactId = null,
      channel = 'webchat',
      senderName = 'Customer',
      body,
      provider = 'operza_webchat',
      providerMessageId = null,
      idempotencyKey = null
    }) {
      if (provider && providerMessageId) {
        const existing = await tx.query(
          `SELECT * FROM messages WHERE agency_id = $1 AND location_id = $2 AND provider = $3 AND provider_message_id = $4`,
          [tx.agencyId, tx.locationId, provider, providerMessageId]
        );
        if (existing.rows.length > 0) {
          return { success: true, deduplicated: true, message: existing.rows[0] };
        }
      }

      const msgRes = await tx.query(
        `INSERT INTO messages (
          id, agency_id, location_id, conversation_id, contact_id, channel, direction,
          sender_type, sender_name, body, delivery_status, provider, provider_message_id, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, 'inbound', 'contact', $7, $8, 'delivered', $9, $10, $11)
        RETURNING *`,
        [
          randomUUID(), tx.agencyId, tx.locationId, conversationId, contactId,
          channel, senderName, String(body || ''), provider, providerMessageId, idempotencyKey
        ]
      );

      await tx.query(
        `UPDATE conversations
         SET last_message = $1,
             last_message_at = now(),
             last_inbound_at = now(),
             unread_count = unread_count + 1,
             status = CASE WHEN status IN ('resolved', 'closed', 'waiting_on_customer') THEN 'open' ELSE status END,
             updated_at = now()
         WHERE agency_id = $2 AND location_id = $3 AND id = $4`,
        [String(body || '').slice(0, 500), tx.agencyId, tx.locationId, conversationId]
      );

      return { success: true, deduplicated: false, message: msgRes.rows[0] };
    },

    async createTicket(tx, data = {}, actorId = 'system') {
      const subject = String(data.subject || '').trim();
      if (subject.length < 2) throw Object.assign(new Error('Ticket subject must be at least 2 characters'), { code: 'INVALID_INPUT', status: 400 });
      const ticketNumber = data.ticketNumber || `TKT-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
      const res = await tx.query(
        `INSERT INTO support_tickets (
          id, agency_id, location_id, ticket_number, conversation_id, contact_id,
          opportunity_id, appointment_id, subject, description, status, priority,
          category, assigned_to, team_id, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11, $12, $13, $14, $15)
        RETURNING *`,
        [
          randomUUID(), tx.agencyId, tx.locationId, ticketNumber,
          data.conversationId || null, data.contactId || null,
          data.opportunityId || null, data.appointmentId || null,
          subject, String(data.description || ''),
          data.priority || 'normal', data.category || 'general',
          data.assignedTo || null, data.teamId || null, actorId
        ]
      );
      return normalizeTicketRow(res.rows[0]);
    },

    async updateTicket(tx, { ticketId, status = undefined, priority = undefined, resolutionSummary = undefined, assignedTo = undefined, teamId = undefined }) {
      const lockRes = await tx.query(
        `SELECT * FROM support_tickets WHERE agency_id = $1 AND location_id = $2 AND id = $3 FOR UPDATE`,
        [tx.agencyId, tx.locationId, ticketId]
      );
      if (lockRes.rows.length === 0) return { notFound: true, code: 'TICKET_NOT_FOUND' };
      const cur = lockRes.rows[0];
      const nextStatus = status ?? cur.status;
      assertValidSupportTransition('ticket', cur.status, nextStatus);
      const isReopen = ['resolved', 'closed'].includes(cur.status) && nextStatus === 'open';

      const upd = await tx.query(
        `UPDATE support_tickets
         SET status = $1,
             priority = $2,
             resolution_summary = COALESCE($3, resolution_summary),
             assigned_to = COALESCE($4, assigned_to),
             team_id = COALESCE($5, team_id),
             resolved_at = CASE WHEN $1 = 'resolved' THEN COALESCE(resolved_at, now()) WHEN $1 = 'open' THEN NULL ELSE resolved_at END,
             closed_at = CASE WHEN $1 = 'closed' THEN COALESCE(closed_at, now()) WHEN $1 = 'open' THEN NULL ELSE closed_at END,
             reopened_count = reopened_count + $6,
             version = version + 1,
             updated_at = now()
         WHERE agency_id = $7 AND location_id = $8 AND id = $9
         RETURNING *`,
        [
          nextStatus, priority ?? cur.priority, resolutionSummary ?? null,
          assignedTo ?? null, teamId ?? null, isReopen ? 1 : 0,
          tx.agencyId, tx.locationId, ticketId
        ]
      );
      return { success: true, reopened: isReopen, ticket: normalizeTicketRow(upd.rows[0]) };
    },

    async listTeams(tx) {
      const res = await tx.query(
        `SELECT * FROM support_teams WHERE agency_id = $1 AND location_id = $2 AND is_active = true ORDER BY name ASC`,
        [tx.agencyId, tx.locationId]
      );
      return res.rows.map(r => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        memberIds: parseJson(r.member_ids, []),
        defaultSlaPolicyId: r.default_sla_policy_id || null
      }));
    },

    async createTeam(tx, { name, description = '', memberIds = [] }) {
      const cleanName = String(name || '').trim();
      const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `team-${Date.now()}`;
      const res = await tx.query(
        `INSERT INTO support_teams (id, agency_id, location_id, name, slug, description, member_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING *`,
        [randomUUID(), tx.agencyId, tx.locationId, cleanName, slug, description, JSON.stringify(memberIds)]
      );
      return res.rows[0];
    },

    async listSlaPolicies(tx) {
      const res = await tx.query(
        `SELECT * FROM sla_policies WHERE agency_id = $1 AND location_id = $2 ORDER BY is_default DESC, created_at DESC`,
        [tx.agencyId, tx.locationId]
      );
      return res.rows;
    },

    async createSlaPolicy(tx, data = {}) {
      const res = await tx.query(
        `INSERT INTO sla_policies (
          id, agency_id, location_id, name, is_default, timezone, business_hours, targets_by_priority, pause_statuses, escalation_minutes_before
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10) RETURNING *`,
        [
          randomUUID(), tx.agencyId, tx.locationId,
          String(data.name || 'Default Support SLA'),
          Boolean(data.isDefault),
          data.timezone || 'UTC',
          JSON.stringify(data.businessHours || { enabled: true, startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5] }),
          JSON.stringify(data.targetsByPriority || {
            urgent: { firstResponseMin: 15, nextResponseMin: 30, resolutionMin: 240 },
            high: { firstResponseMin: 60, nextResponseMin: 120, resolutionMin: 480 },
            normal: { firstResponseMin: 240, nextResponseMin: 480, resolutionMin: 1440 },
            low: { firstResponseMin: 480, nextResponseMin: 1440, resolutionMin: 2880 }
          }),
          JSON.stringify(data.pauseStatuses || ['waiting_on_customer']),
          Math.max(1, Number(data.escalationMinutesBefore) || 30)
        ]
      );
      return res.rows[0];
    },

    async applySlaToConversation(tx, { conversationId, policyId = null }) {
      const convRes = await tx.query(
        `SELECT * FROM conversations WHERE agency_id = $1 AND location_id = $2 AND id = $3 FOR UPDATE`,
        [tx.agencyId, tx.locationId, conversationId]
      );
      if (convRes.rows.length === 0) return null;
      const conv = convRes.rows[0];

      const policyRes = policyId
        ? await tx.query(`SELECT * FROM sla_policies WHERE agency_id = $1 AND location_id = $2 AND id = $3`, [tx.agencyId, tx.locationId, policyId])
        : await tx.query(`SELECT * FROM sla_policies WHERE agency_id = $1 AND location_id = $2 AND is_active = true ORDER BY is_default DESC LIMIT 1`, [tx.agencyId, tx.locationId]);
      const policy = policyRes.rows[0] || null;
      if (!policy) return normalizeInboxConversation(conv);

      const deadlines = computeSlaDeadlines({
        createdAt: conv.created_at,
        priority: conv.priority || 'normal',
        policy
      });
      const upd = await tx.query(
        `UPDATE conversations
         SET sla_policy_id = $1,
             sla_first_response_due_at = $2,
             sla_next_response_due_at = $3,
             sla_resolution_due_at = $4,
             sla_status = 'on_track',
             updated_at = now()
         WHERE agency_id = $5 AND location_id = $6 AND id = $7
         RETURNING *`,
        [policy.id, deadlines.firstResponseDueAt, deadlines.nextResponseDueAt, deadlines.resolutionDueAt, tx.agencyId, tx.locationId, conversationId]
      );
      return normalizeInboxConversation(upd.rows[0]);
    },

    async listSavedReplies(tx, { includeArchived = false, scope = 'all', actorId = null } = {}) {
      const clauses = ['agency_id = $1', 'location_id = $2'];
      const params = [tx.agencyId, tx.locationId];
      if (!includeArchived) clauses.push('archived = false');
      if (scope !== 'all') {
        params.push(scope);
        clauses.push(`scope = $${params.length}`);
      }
      if (actorId) {
        params.push(actorId);
        clauses.push(`(scope <> 'personal' OR owner_id = $${params.length})`);
      }
      const res = await tx.query(`SELECT * FROM support_saved_replies WHERE ${clauses.join(' AND ')} ORDER BY title ASC`, params);
      return res.rows;
    },

    async createSavedReply(tx, data = {}, actorId = 'system') {
      const check = validateSavedReplyTemplate(data.body || '');
      if (!check.valid) throw Object.assign(new Error(check.error), { code: check.code, status: 400 });
      const res = await tx.query(
        `INSERT INTO support_saved_replies (
          id, agency_id, location_id, title, category, scope, owner_id, team_id, channel, body, variables, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
        RETURNING *`,
        [
          randomUUID(), tx.agencyId, tx.locationId,
          String(data.title || '').trim(), data.category || 'general',
          data.scope || 'agency', data.scope === 'personal' ? actorId : (data.ownerId || null),
          data.teamId || null, data.channel || 'all', data.body,
          JSON.stringify(check.variables), actorId
        ]
      );
      return res.rows[0];
    },

    async getCustomer360Context(tx, { contactId, includeFinancials = false }) {
      if (!contactId) return null;
      const contactRes = await tx.query(
        `SELECT id, body, created_at FROM location_records
         WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts' AND id = $3`,
        [tx.agencyId, tx.locationId, contactId]
      );
      if (contactRes.rows.length === 0) return null;
      const contactBody = parseJson(contactRes.rows[0].body, {});
      const contact = {
        id: contactRes.rows[0].id,
        first_name: contactBody.firstName || '',
        last_name: contactBody.lastName || '',
        email: contactBody.email || null,
        phone: contactBody.phone || null,
        company: contactBody.company || null,
        status: contactBody.status || 'active',
        tags: contactBody.tags || [],
        created_at: iso(contactRes.rows[0].created_at)
      };

      const oppsRes = await tx.query(
        `SELECT id, body, updated_at FROM location_records
         WHERE agency_id = $1 AND location_id = $2 AND collection = 'opportunities'
           AND (body->>'contactId') = $3
         ORDER BY updated_at DESC LIMIT 10`,
        [tx.agencyId, tx.locationId, String(contactId)]
      );

      const apptsRes = await tx.query(
        `SELECT id, body, created_at FROM location_records
         WHERE agency_id = $1 AND location_id = $2 AND collection = 'appointments'
           AND (body->>'contactId') = $3
         ORDER BY created_at DESC LIMIT 10`,
        [tx.agencyId, tx.locationId, String(contactId)]
      );

      const consentsRes = await tx.query(
        `SELECT channel, purpose, status, captured_at
         FROM communication_consents WHERE agency_id = $1 AND location_id = $2 AND contact_id = $3
         ORDER BY captured_at DESC LIMIT 20`,
        [tx.agencyId, tx.locationId, contactId]
      );

      const ticketsRes = await tx.query(
        `SELECT id, ticket_number, subject, status, priority, created_at
         FROM support_tickets WHERE agency_id = $1 AND location_id = $2 AND contact_id = $3
         ORDER BY created_at DESC LIMIT 10`,
        [tx.agencyId, tx.locationId, contactId]
      );

      let financials = { authorized: includeFinancials, invoices: [], orders: [] };
      if (includeFinancials) {
        const invRes = await tx.query(
          `SELECT id, body, created_at FROM location_records
           WHERE agency_id = $1 AND location_id = $2 AND collection = 'invoices'
             AND (body->>'contactId') = $3
           ORDER BY created_at DESC LIMIT 10`,
          [tx.agencyId, tx.locationId, String(contactId)]
        );
        financials = {
          authorized: true,
          invoices: invRes.rows.map(r => ({ id: r.id, ...parseJson(r.body, {}), createdAt: iso(r.created_at) })),
          orders: []
        };
      }

      return {
        contact,
        opportunities: oppsRes.rows.map(r => ({ id: r.id, ...parseJson(r.body, {}) })),
        appointments: apptsRes.rows.map(r => ({ id: r.id, ...parseJson(r.body, {}) })),
        consents: consentsRes.rows,
        tickets: ticketsRes.rows.map(normalizeTicketRow),
        financials
      };
    },

    async getSupportDashboardMetrics(tx) {
      const statsRes = await tx.query(
        `SELECT
           COUNT(*)::int AS total_conversations,
           COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
           COUNT(*) FILTER (WHERE status IN ('open', 'pending', 'waiting_on_customer', 'waiting_on_internal') AND (assigned_to IS NULL OR assigned_to = ''))::int AS unassigned_count,
           COUNT(*) FILTER (WHERE sla_breached = true OR sla_status = 'breached')::int AS overdue_count,
           COUNT(*) FILTER (WHERE status IN ('resolved', 'closed'))::int AS resolved_count,
           COALESCE(AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) * 1000) FILTER (WHERE first_response_at IS NOT NULL), 0)::float8 AS avg_first_response_ms,
           COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) * 1000) FILTER (WHERE resolved_at IS NOT NULL), 0)::float8 AS avg_resolution_ms
         FROM conversations
         WHERE agency_id = $1 AND location_id = $2`,
        [tx.agencyId, tx.locationId]
      );

      const byAgentRes = await tx.query(
        `SELECT COALESCE(assigned_to, 'unassigned') AS agent_id,
                COALESCE(MAX(assigned_agent_name), 'Unassigned') AS agent_name,
                COUNT(*)::int AS count
         FROM conversations
         WHERE agency_id = $1 AND location_id = $2 AND status IN ('open', 'pending', 'waiting_on_customer', 'waiting_on_internal')
         GROUP BY COALESCE(assigned_to, 'unassigned')
         ORDER BY count DESC LIMIT 15`,
        [tx.agencyId, tx.locationId]
      );

      const byTeamRes = await tx.query(
        `SELECT COALESCE(team_id::text, 'unassigned') AS team_id, COUNT(*)::int AS count
         FROM conversations
         WHERE agency_id = $1 AND location_id = $2 AND status IN ('open', 'pending', 'waiting_on_customer', 'waiting_on_internal')
         GROUP BY COALESCE(team_id::text, 'unassigned')
         ORDER BY count DESC LIMIT 15`,
        [tx.agencyId, tx.locationId]
      );

      const slaPoliciesCountRes = await tx.query(
        `SELECT COUNT(*)::int AS count FROM sla_policies WHERE agency_id = $1 AND location_id = $2 AND is_active = true`,
        [tx.agencyId, tx.locationId]
      );

      const s = statsRes.rows[0] || {};
      const total = s.total_conversations || 0;
      const resolved = s.resolved_count || 0;
      const overdue = s.overdue_count || 0;
      return {
        totalConversations: total,
        openCount: s.open_count || 0,
        unassignedCount: s.unassigned_count || 0,
        overdueCount: overdue,
        resolvedCount: resolved,
        avgFirstResponseMs: Math.round(s.avg_first_response_ms || 0),
        avgResolutionMs: Math.round(s.avg_resolution_ms || 0),
        resolutionRate: total > 0 ? Number((resolved / total).toFixed(4)) : 0,
        slaComplianceRate: total > 0 ? Number(((total - overdue) / total).toFixed(4)) : 1,
        slaPolicyConfigured: (slaPoliciesCountRes.rows[0]?.count || 0) > 0,
        smallSampleWarning: total < 10,
        workloadByAgent: byAgentRes.rows,
        workloadByTeam: byTeamRes.rows
      };
    }
  };
}
