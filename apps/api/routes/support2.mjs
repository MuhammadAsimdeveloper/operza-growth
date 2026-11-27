/**
 * ============================================================================
 * Operza Unified Inbox & Customer Support 2.0 Router
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createUnifiedInboxRepository } from '../../../packages/db/lib/unified-inbox-repository.mjs';
import {
  assertValidSupportTransition,
  buildAiSupportSuggestion,
  buildSupportWorkflowEvent,
  computeSlaDeadlines,
  evaluateSlaStatus,
  renderSafeSavedReply,
  resolveChannelConnectionStatus,
  validateSavedReplyTemplate
} from '../../../packages/platform-core/src/unified-inbox-2-0.mjs';

const inboxRepo = createUnifiedInboxRepository();

function checkScope(actor, requiredScope, alternativeScopes = []) {
  if (!actor || !actor.apiKey) return true;
  const scopes = actor.scopes || [];
  if (scopes.includes('*') || scopes.includes('all')) return true;
  if (scopes.includes(requiredScope)) return true;
  return alternativeScopes.some(alt => scopes.includes(alt));
}

function canViewFinancials(actor) {
  if (!actor) return false;
  if (actor.apiKey) {
    const scopes = actor.scopes || [];
    return scopes.includes('*') || scopes.includes('all') || scopes.includes('billing:read') || scopes.includes('payments:read');
  }
  const role = String(actor.user?.role || actor.role || 'owner').toLowerCase();
  return ['owner', 'admin', 'billing', 'manager'].includes(role);
}

export async function handleSupport2Routes({ req, res, pathname, method, ctx }) {
  if (!pathname.startsWith('/api/support/v2')) return false;

  const {
    url,
    pgPool,
    agency,
    activeLocation,
    actor,
    readBody,
    sendJson,
    auditLog,
    state,
    saveState
  } = ctx;

  if (!agency || !activeLocation) {
    sendJson(res, 401, { error: 'Active agency and location context required', code: 'TENANT_CONTEXT_REQUIRED' });
    return true;
  }

  const subPath = pathname.replace(/^\/api\/support\/v2/, '');
  const queryUrl = url || new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);
  const actorId = actor?.user?.id || actor?.keyId || 'system';
  const actorName = actor?.user?.name || 'Support Agent';
  const tenantCtx = { agencyId: agency.id, locationId: activeLocation.id, actorId };
  const sendingEnabled = process.env.OPERZA_LIVE_MESSAGING === 'true';

  // Ensure in-memory collections exist for !pgPool fallback
  const memConvs = state.conversations || state.records?.conversations || [];
  state.supportTeams = state.supportTeams || [];
  state.supportTickets = state.supportTickets || [];
  state.slaPolicies = state.slaPolicies || [];
  state.supportSavedReplies = state.supportSavedReplies || [];
  state.supportNotes = state.supportNotes || [];
  state.supportHistory = state.supportHistory || [];

  // 1. Channel Connection Status
  if (method === 'GET' && subPath === '/channels/status') {
    if (!checkScope(actor, 'conversations:read', ['support:read'])) {
      sendJson(res, 403, { error: 'Insufficient scope', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const connections = (state.integrations || state.records?.integrations || []).filter(
      c => (!c.agencyId || c.agencyId === agency.id)
    );
    const channels = ['webchat', 'email', 'sms', 'whatsapp', 'meta', 'voice'].map(ch =>
      resolveChannelConnectionStatus({ channel: ch, connections, sendingEnabled })
    );
    sendJson(res, 200, { channels });
    return true;
  }

  // 2. Support Performance & SLA Dashboard Metrics
  if (method === 'GET' && subPath === '/metrics') {
    if (!checkScope(actor, 'conversations:read', ['support:read'])) {
      sendJson(res, 403, { error: 'Insufficient scope', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    if (pgPool) {
      const metrics = await runInTenantTx(pgPool, tenantCtx, tx => inboxRepo.getSupportDashboardMetrics(tx));
      sendJson(res, 200, metrics);
      return true;
    }
    const scoped = memConvs.filter(c => (!c.agencyId || c.agencyId === agency.id) && (!c.locationId || c.locationId === activeLocation.id));
    const total = scoped.length;
    const openCount = scoped.filter(c => (c.status || 'open') === 'open').length;
    const unassignedCount = scoped.filter(c => !c.assignedTo && !['resolved', 'closed'].includes(c.status || 'open')).length;
    const overdueCount = scoped.filter(c => c.slaBreached).length;
    const resolvedCount = scoped.filter(c => ['resolved', 'closed'].includes(c.status || '')).length;
    sendJson(res, 200, {
      totalConversations: total,
      openCount,
      unassignedCount,
      overdueCount,
      resolvedCount,
      avgFirstResponseMs: 0,
      avgResolutionMs: 0,
      resolutionRate: total > 0 ? Number((resolvedCount / total).toFixed(4)) : 0,
      slaComplianceRate: total > 0 ? Number(((total - overdueCount) / total).toFixed(4)) : 1,
      slaPolicyConfigured: state.slaPolicies.some(p => p.agencyId === agency.id),
      smallSampleWarning: total < 10,
      workloadByAgent: [],
      workloadByTeam: []
    });
    return true;
  }

  // 3. Server-Side Filtered & Paginated Inbox
  if (method === 'GET' && subPath === '/conversations') {
    if (!checkScope(actor, 'conversations:read', ['support:read'])) {
      sendJson(res, 403, { error: 'Insufficient scope', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const filters = {
      view: queryUrl.searchParams.get('view') || 'all',
      status: queryUrl.searchParams.get('status') || undefined,
      priority: queryUrl.searchParams.get('priority') || undefined,
      channel: queryUrl.searchParams.get('channel') || undefined,
      teamId: queryUrl.searchParams.get('teamId') || undefined,
      assignedTo: queryUrl.searchParams.get('assignedTo') || undefined,
      slaStatus: queryUrl.searchParams.get('slaStatus') || undefined,
      tag: queryUrl.searchParams.get('tag') || undefined,
      search: queryUrl.searchParams.get('search') || undefined,
      limit: Number(queryUrl.searchParams.get('limit')) || 25,
      offset: Number(queryUrl.searchParams.get('offset')) || 0,
      actorId
    };
    if (pgPool) {
      const result = await runInTenantTx(pgPool, tenantCtx, tx => inboxRepo.listInboxConversations(tx, filters));
      sendJson(res, 200, result);
      return true;
    }
    const scoped = memConvs
      .filter(c => (!c.agencyId || c.agencyId === agency.id) && (!c.locationId || c.locationId === activeLocation.id))
      .filter(c => {
        const st = c.status || 'open';
        if (filters.view === 'unassigned' && c.assignedTo) return false;
        if (filters.view === 'assigned_to_me' && c.assignedTo !== actorId) return false;
        if (['open', 'pending', 'waiting_on_customer', 'waiting_on_internal', 'resolved', 'closed'].includes(filters.view) && st !== filters.view) return false;
        if (filters.view === 'high_priority' && !['high', 'urgent'].includes(c.priority || 'normal')) return false;
        if (filters.view === 'overdue_sla' && !c.slaBreached) return false;
        if (filters.status && filters.status !== 'all' && st !== filters.status) return false;
        if (filters.priority && filters.priority !== 'all' && (c.priority || 'normal') !== filters.priority) return false;
        if (filters.channel && filters.channel !== 'all' && c.channel !== filters.channel) return false;
        if (filters.search) {
          const q = filters.search.toLowerCase();
          if (!String(c.contactName || '').toLowerCase().includes(q) && !String(c.lastMessage || '').toLowerCase().includes(q)) return false;
        }
        return true;
      });
    const limit = Math.min(100, Math.max(1, filters.limit));
    const offset = Math.max(0, filters.offset);
    sendJson(res, 200, { items: scoped.slice(offset, offset + limit), total: scoped.length, limit, offset });
    return true;
  }

  // 4. Conversation Detail (with Internal Notes — Staff Only)
  const convDetailMatch = subPath.match(/^\/conversations\/([^/]+)$/);
  if (method === 'GET' && convDetailMatch) {
    if (!checkScope(actor, 'conversations:read', ['support:read'])) {
      sendJson(res, 403, { error: 'Insufficient scope', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const conversationId = convDetailMatch[1];
    const connections = state.integrations || state.records?.integrations || [];
    if (pgPool) {
      const detail = await runInTenantTx(pgPool, tenantCtx, tx =>
        inboxRepo.getInboxConversationDetail(tx, { conversationId, includeInternalNotes: true })
      );
      if (!detail) {
        sendJson(res, 404, { error: 'Conversation not found', code: 'CONVERSATION_NOT_FOUND' });
        return true;
      }
      sendJson(res, 200, {
        ...detail,
        channelConnection: resolveChannelConnectionStatus({ channel: detail.conversation.channel, connections, sendingEnabled })
      });
      return true;
    }
    const conv = memConvs.find(c => c.id === conversationId);
    if (!conv) {
      sendJson(res, 404, { error: 'Conversation not found', code: 'CONVERSATION_NOT_FOUND' });
      return true;
    }
    sendJson(res, 200, {
      conversation: { ...conv, status: conv.status || 'open', priority: conv.priority || 'normal', version: conv.version || 1 },
      messages: conv.messages || [],
      internalNotes: state.supportNotes.filter(n => n.conversationId === conversationId),
      history: state.supportHistory.filter(h => h.conversationId === conversationId),
      tickets: state.supportTickets.filter(t => t.conversationId === conversationId),
      channelConnection: resolveChannelConnectionStatus({ channel: conv.channel, connections, sendingEnabled })
    });
    return true;
  }

  // 5. Assignment & Team Transfer
  const assignMatch = subPath.match(/^\/conversations\/([^/]+)\/assign$/);
  if (method === 'POST' && assignMatch) {
    if (!checkScope(actor, 'conversations:write', ['support:write'])) {
      sendJson(res, 403, { error: 'Insufficient scope', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const conversationId = assignMatch[1];
    const body = await readBody(req);
    if (pgPool) {
      const result = await runInTenantTx(pgPool, tenantCtx, tx =>
        inboxRepo.assignConversation(tx, {
          conversationId,
          assignedTo: body?.assignedTo ?? null,
          assignedAgentName: body?.assignedAgentName ?? null,
          teamId: body?.teamId,
          expectedVersion: body?.expectedVersion,
          actorId
        })
      );
      if (result.notFound) {
        sendJson(res, 404, { error: 'Conversation not found', code: result.code });
        return true;
      }
      if (result.conflict) {
        sendJson(res, 409, result);
        return true;
      }
      const wfEvent = buildSupportWorkflowEvent({
        agencyId: agency.id,
        locationId: activeLocation.id,
        eventType: 'conversation.assigned',
        entityId: conversationId,
        payload: { assignedTo: body?.assignedTo ?? null, teamId: body?.teamId ?? null }
      });
      auditLog?.('support.conversation.assigned', actor, { conversationId, assignedTo: body?.assignedTo ?? null });
      sendJson(res, 200, { ...result, workflowEvent: wfEvent });
      return true;
    }
    const conv = memConvs.find(c => c.id === conversationId);
    if (!conv) {
      sendJson(res, 404, { error: 'Conversation not found', code: 'CONVERSATION_NOT_FOUND' });
      return true;
    }
    if (body?.expectedVersion !== undefined && (conv.version || 1) !== Number(body.expectedVersion)) {
      sendJson(res, 409, { conflict: true, code: 'ASSIGNMENT_VERSION_CONFLICT', error: 'Conversation was modified by another agent.' });
      return true;
    }
    conv.assignedTo = body?.assignedTo ?? null;
    conv.assignedAgentName = body?.assignedAgentName ?? null;
    if (body?.teamId !== undefined) conv.teamId = body.teamId;
    conv.version = (conv.version || 1) + 1;
    state.supportHistory.unshift({ id: randomUUID(), conversationId, actorId, eventType: 'assignment_changed', toValue: conv.assignedTo || 'unassigned', createdAt: new Date().toISOString() });
    await saveState?.();
    sendJson(res, 200, { success: true, conversation: conv });
    return true;
  }

  // 6. Conversation Lifecycle (Status / Priority / Tags)
  const lifecycleMatch = subPath.match(/^\/conversations\/([^/]+)\/lifecycle$/);
  if (method === 'PATCH' && lifecycleMatch) {
    if (!checkScope(actor, 'conversations:write', ['support:write'])) {
      sendJson(res, 403, { error: 'Insufficient scope', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const conversationId = lifecycleMatch[1];
    const body = await readBody(req);
    if (pgPool) {
      try {
        const result = await runInTenantTx(pgPool, tenantCtx, tx =>
          inboxRepo.updateConversationLifecycle(tx, {
            conversationId,
            status: body?.status,
            priority: body?.priority,
            tags: body?.tags,
            expectedVersion: body?.expectedVersion,
            actorId
          })
        );
        if (result.notFound) {
          sendJson(res, 404, { error: 'Conversation not found', code: result.code });
          return true;
        }
        if (result.conflict) {
          sendJson(res, 409, result);
          return true;
        }
        auditLog?.('support.conversation.lifecycle_updated', actor, { conversationId, status: body?.status, priority: body?.priority });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, err.status || 400, { error: err.message, code: err.code || 'LIFECYCLE_UPDATE_FAILED' });
      }
      return true;
    }
    const conv = memConvs.find(c => c.id === conversationId);
    if (!conv) {
      sendJson(res, 404, { error: 'Conversation not found', code: 'CONVERSATION_NOT_FOUND' });
      return true;
    }
    if (body?.status) {
      assertValidSupportTransition('conversation', conv.status || 'open', body.status);
      conv.status = body.status;
    }
    if (body?.priority) conv.priority = body.priority;
    if (Array.isArray(body?.tags)) conv.tags = body.tags;
    conv.version = (conv.version || 1) + 1;
    await saveState?.();
    sendJson(res, 200, { success: true, conversation: conv });
    return true;
  }

  // 7. Public Reply & Internal Note
  const replyMatch = subPath.match(/^\/conversations\/([^/]+)\/reply$/);
  if (method === 'POST' && replyMatch) {
    if (!checkScope(actor, 'conversations:write', ['support:write'])) {
      sendJson(res, 403, { error: 'Insufficient scope', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const conversationId = replyMatch[1];
    const body = await readBody(req);
    const connections = state.integrations || state.records?.integrations || [];
    const chStatus = resolveChannelConnectionStatus({ channel: body?.channel || 'webchat', connections, sendingEnabled });
    const deliveryStatus = chStatus.canSendOutbound ? 'sent' : 'queued';

    if (pgPool) {
      const result = await runInTenantTx(pgPool, tenantCtx, tx =>
        inboxRepo.addPublicReply(tx, {
          conversationId,
          body: body?.body,
          subject: body?.subject || null,
          channel: body?.channel || null,
          senderName: actorName,
          deliveryStatus,
          provider: chStatus.provider,
          idempotencyKey: body?.idempotencyKey || null
        })
      );
      if (result.notFound) {
        sendJson(res, 404, { error: 'Conversation not found', code: result.code });
        return true;
      }
      auditLog?.('support.conversation.public_reply', actor, { conversationId, deliveryStatus });
      sendJson(res, 201, { ...result, channelConnection: chStatus });
      return true;
    }
    const conv = memConvs.find(c => c.id === conversationId);
    if (!conv) {
      sendJson(res, 404, { error: 'Conversation not found', code: 'CONVERSATION_NOT_FOUND' });
      return true;
    }
    const msg = {
      id: randomUUID(),
      conversationId,
      direction: 'outbound',
      senderType: 'agent',
      senderName: actorName,
      body: String(body?.body || '').trim(),
      deliveryStatus,
      createdAt: new Date().toISOString()
    };
    conv.messages = conv.messages || [];
    conv.messages.push(msg);
    conv.lastMessage = msg.body;
    await saveState?.();
    sendJson(res, 201, { success: true, message: msg, conversation: conv, channelConnection: chStatus });
    return true;
  }

  const noteMatch = subPath.match(/^\/conversations\/([^/]+)\/notes$/);
  if (method === 'POST' && noteMatch) {
    if (!checkScope(actor, 'conversations:write', ['support:write'])) {
      sendJson(res, 403, { error: 'Insufficient scope', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const conversationId = noteMatch[1];
    const body = await readBody(req);
    if (pgPool) {
      const note = await runInTenantTx(pgPool, tenantCtx, tx =>
        inboxRepo.addInternalNote(tx, { conversationId, authorId: actorId, authorName: actorName, body: body?.body })
      );
      auditLog?.('support.conversation.internal_note', actor, { conversationId, noteId: note.id });
      sendJson(res, 201, { note });
      return true;
    }
    const note = { id: randomUUID(), conversationId, authorId: actorId, authorName: actorName, body: String(body?.body || '').trim(), isInternal: true, createdAt: new Date().toISOString() };
    state.supportNotes.push(note);
    await saveState?.();
    sendJson(res, 201, { note });
    return true;
  }

  // 8. AI-Assisted Support Suggestion (Redacted + Human Approval Required)
  const aiMatch = subPath.match(/^\/conversations\/([^/]+)\/ai-suggest$/);
  if (method === 'POST' && aiMatch) {
    if (!checkScope(actor, 'conversations:read', ['ai:read'])) {
      sendJson(res, 403, { error: 'Insufficient scope', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const conversationId = aiMatch[1];
    const body = await readBody(req);
    let messages = body?.messages || [];
    if (pgPool && messages.length === 0) {
      const detail = await runInTenantTx(pgPool, tenantCtx, tx =>
        inboxRepo.getInboxConversationDetail(tx, { conversationId, includeInternalNotes: false })
      );
      messages = detail?.messages || [];
    }
    const suggestion = await buildAiSupportSuggestion({
      messages,
      contact: body?.contact || null,
      aiConfig: {
        enabled: Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
        hasCredentials: Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
        consentGranted: true
      }
    });
    sendJson(res, 200, suggestion);
    return true;
  }

  // 9. Support Teams, SLA Policies, Tickets, Saved Replies & Customer 360
  if (subPath === '/teams') {
    if (method === 'GET') {
      const teams = pgPool
        ? await runInTenantTx(pgPool, tenantCtx, tx => inboxRepo.listTeams(tx))
        : state.supportTeams.filter(t => t.agencyId === agency.id);
      sendJson(res, 200, { teams });
      return true;
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const team = pgPool
        ? await runInTenantTx(pgPool, tenantCtx, tx => inboxRepo.createTeam(tx, body || {}))
        : { id: randomUUID(), agencyId: agency.id, locationId: activeLocation.id, ...(body || {}) };
      if (!pgPool) { state.supportTeams.push(team); await saveState?.(); }
      auditLog?.('support.team.created', actor, { teamId: team.id });
      sendJson(res, 201, { team });
      return true;
    }
  }

  if (subPath === '/sla-policies') {
    if (method === 'GET') {
      const policies = pgPool
        ? await runInTenantTx(pgPool, tenantCtx, tx => inboxRepo.listSlaPolicies(tx))
        : state.slaPolicies.filter(p => p.agencyId === agency.id);
      sendJson(res, 200, { policies });
      return true;
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const policy = pgPool
        ? await runInTenantTx(pgPool, tenantCtx, tx => inboxRepo.createSlaPolicy(tx, body || {}))
        : { id: randomUUID(), agencyId: agency.id, locationId: activeLocation.id, ...(body || {}) };
      if (!pgPool) { state.slaPolicies.push(policy); await saveState?.(); }
      auditLog?.('support.sla_policy.created', actor, { policyId: policy.id });
      sendJson(res, 201, { policy });
      return true;
    }
  }

  if (subPath === '/tickets') {
    if (method === 'GET') {
      if (pgPool) {
        const rows = await runInTenantTx(pgPool, tenantCtx, async tx => {
          const r = await tx.query(`SELECT * FROM support_tickets WHERE agency_id = $1 AND location_id = $2 ORDER BY updated_at DESC LIMIT 100`, [tx.agencyId, tx.locationId]);
          return r.rows;
        });
        sendJson(res, 200, { tickets: rows });
        return true;
      }
      sendJson(res, 200, { tickets: state.supportTickets.filter(t => t.agencyId === agency.id) });
      return true;
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const ticket = pgPool
        ? await runInTenantTx(pgPool, tenantCtx, tx => inboxRepo.createTicket(tx, body || {}, actorId))
        : { id: randomUUID(), ticketNumber: `TKT-${Date.now().toString(36).toUpperCase()}`, agencyId: agency.id, status: 'open', ...(body || {}) };
      if (!pgPool) { state.supportTickets.push(ticket); await saveState?.(); }
      auditLog?.('support.ticket.created', actor, { ticketId: ticket.id, ticketNumber: ticket.ticketNumber });
      sendJson(res, 201, { ticket });
      return true;
    }
  }

  const ticketPatchMatch = subPath.match(/^\/tickets\/([^/]+)$/);
  if (method === 'PATCH' && ticketPatchMatch) {
    const ticketId = ticketPatchMatch[1];
    const body = await readBody(req);
    if (pgPool) {
      const result = await runInTenantTx(pgPool, tenantCtx, tx => inboxRepo.updateTicket(tx, { ticketId, ...(body || {}) }));
      if (result.notFound) { sendJson(res, 404, { error: 'Ticket not found', code: result.code }); return true; }
      auditLog?.('support.ticket.updated', actor, { ticketId, status: body?.status });
      sendJson(res, 200, result);
      return true;
    }
    const ticket = state.supportTickets.find(t => t.id === ticketId);
    if (!ticket) { sendJson(res, 404, { error: 'Ticket not found' }); return true; }
    if (body?.status) { assertValidSupportTransition('ticket', ticket.status, body.status); ticket.status = body.status; }
    if (body?.priority) ticket.priority = body.priority;
    await saveState?.();
    sendJson(res, 200, { success: true, ticket });
    return true;
  }

  if (subPath === '/saved-replies') {
    if (method === 'GET') {
      const replies = pgPool
        ? await runInTenantTx(pgPool, tenantCtx, tx => inboxRepo.listSavedReplies(tx, { actorId }))
        : state.supportSavedReplies.filter(r => !r.archived && r.agencyId === agency.id);
      sendJson(res, 200, { replies });
      return true;
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const check = validateSavedReplyTemplate(body?.body || '');
      if (!check.valid) { sendJson(res, 400, { error: check.error, code: check.code }); return true; }
      const reply = pgPool
        ? await runInTenantTx(pgPool, tenantCtx, tx => inboxRepo.createSavedReply(tx, body || {}, actorId))
        : { id: randomUUID(), agencyId: agency.id, ...(body || {}), variables: check.variables };
      if (!pgPool) { state.supportSavedReplies.push(reply); await saveState?.(); }
      sendJson(res, 201, { reply });
      return true;
    }
  }

  if (method === 'POST' && subPath === '/saved-replies/render') {
    const body = await readBody(req);
    try {
      const rendered = renderSafeSavedReply(body?.body || '', { ...(body?.context || {}), agency: { name: agency.name }, agent: { name: actorName } });
      sendJson(res, 200, { rendered });
    } catch (err) {
      sendJson(res, 400, { error: err.message, code: err.code || 'INVALID_TEMPLATE' });
    }
    return true;
  }

  const c360Match = subPath.match(/^\/contacts\/([^/]+)\/360$/);
  if (method === 'GET' && c360Match) {
    if (!checkScope(actor, 'contacts:read', ['conversations:read'])) {
      sendJson(res, 403, { error: 'Insufficient scope', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const contactId = c360Match[1];
    const includeFinancials = canViewFinancials(actor);
    if (pgPool) {
      const data = await runInTenantTx(pgPool, tenantCtx, tx => inboxRepo.getCustomer360Context(tx, { contactId, includeFinancials }));
      if (!data) { sendJson(res, 404, { error: 'Contact not found' }); return true; }
      sendJson(res, 200, data);
      return true;
    }
    const contact = (state.contacts || []).find(c => c.id === contactId && (!c.agencyId || c.agencyId === agency.id));
    if (!contact) { sendJson(res, 404, { error: 'Contact not found' }); return true; }
    sendJson(res, 200, {
      contact,
      opportunities: (state.opportunities || []).filter(o => o.contactId === contactId).slice(0, 10),
      appointments: (state.appointments || []).filter(a => a.contactId === contactId).slice(0, 10),
      consents: [],
      tickets: state.supportTickets.filter(t => t.contactId === contactId),
      financials: {
        authorized: includeFinancials,
        invoices: includeFinancials ? (state.invoices || []).filter(i => i.contactId === contactId).slice(0, 10) : [],
        orders: []
      }
    });
    return true;
  }

  return false;
}
