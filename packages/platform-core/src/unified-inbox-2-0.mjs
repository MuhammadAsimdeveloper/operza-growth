/**
 * ============================================================================
 * Operza Unified Inbox & Customer Support 2.0 Domain Engine
 * ============================================================================
 * Conversation & ticket state machines, channel availability honesty,
 * timezone/business-hours SLA calculation, safe saved-reply rendering,
 * AI support governance, and idempotent workflow event construction.
 */

import { createHash } from 'node:crypto';
import { redactSensitivePayload } from '../../workflow-engine/src/graph-validator-v2.mjs';

export const CONVERSATION_STATUSES = Object.freeze([
  'open',
  'pending',
  'waiting_on_customer',
  'waiting_on_internal',
  'resolved',
  'closed',
  'archived'
]);

export const TICKET_STATUSES = Object.freeze([
  'open',
  'pending',
  'waiting_on_customer',
  'waiting_on_internal',
  'resolved',
  'closed'
]);

export const VALID_PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent']);

export const CONVERSATION_TRANSITIONS = Object.freeze({
  open: new Set(['pending', 'waiting_on_customer', 'waiting_on_internal', 'resolved', 'closed', 'archived']),
  pending: new Set(['open', 'waiting_on_customer', 'waiting_on_internal', 'resolved', 'closed', 'archived']),
  waiting_on_customer: new Set(['open', 'pending', 'waiting_on_internal', 'resolved', 'closed', 'archived']),
  waiting_on_internal: new Set(['open', 'pending', 'waiting_on_customer', 'resolved', 'closed', 'archived']),
  resolved: new Set(['open', 'closed', 'archived']),
  closed: new Set(['open', 'archived']),
  archived: new Set(['open'])
});

export const TICKET_TRANSITIONS = Object.freeze({
  open: new Set(['pending', 'waiting_on_customer', 'waiting_on_internal', 'resolved', 'closed']),
  pending: new Set(['open', 'waiting_on_customer', 'waiting_on_internal', 'resolved', 'closed']),
  waiting_on_customer: new Set(['open', 'pending', 'waiting_on_internal', 'resolved', 'closed']),
  waiting_on_internal: new Set(['open', 'pending', 'waiting_on_customer', 'resolved', 'closed']),
  resolved: new Set(['open', 'closed']),
  closed: new Set(['open'])
});

export function isValidSupportTransition(kind, fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  const map = kind === 'ticket' ? TICKET_TRANSITIONS : CONVERSATION_TRANSITIONS;
  return Boolean(map[fromStatus]?.has(toStatus));
}

export function assertValidSupportTransition(kind, fromStatus, toStatus) {
  if (!isValidSupportTransition(kind, fromStatus, toStatus)) {
    throw Object.assign(
      new Error(`Invalid ${kind} status transition from '${fromStatus}' to '${toStatus}'`),
      { code: 'INVALID_STATUS_TRANSITION', status: 409, fromStatus, toStatus }
    );
  }
}

export const CHANNEL_CONNECTION_STATES = Object.freeze({
  CONNECTED: 'connected',
  PENDING_APPROVAL: 'pending_approval',
  NOT_CONFIGURED: 'not_configured',
  DISCONNECTED: 'disconnected',
  TEMPORARILY_UNAVAILABLE: 'temporarily_unavailable',
  SENDING_DISABLED: 'sending_disabled'
});

export function resolveChannelConnectionStatus({ channel, connections = [], sendingEnabled = true } = {}) {
  const ch = String(channel || 'webchat').toLowerCase();
  if (ch === 'webchat') {
    return {
      channel: 'webchat',
      status: sendingEnabled ? CHANNEL_CONNECTION_STATES.CONNECTED : CHANNEL_CONNECTION_STATES.SENDING_DISABLED,
      canSendOutbound: Boolean(sendingEnabled),
      provider: 'operza_webchat',
      detail: sendingEnabled ? 'Built-in web chat adapter ready' : 'Outbound sending disabled by workspace policy'
    };
  }

  const providerHints = {
    email: ['resend', 'sendgrid', 'smtp', 'outlook', 'gmail', 'email'],
    sms: ['twilio', 'sms'],
    whatsapp: ['whatsapp', 'meta_whatsapp', 'twilio_whatsapp'],
    meta: ['meta', 'facebook', 'instagram'],
    voice: ['twilio', 'voice']
  };
  const hints = providerHints[ch] || [ch];
  const matched = (connections || []).find(c => {
    const key = String(c.providerKey || c.provider_key || c.provider || c.channel || '').toLowerCase();
    return hints.some(h => key.includes(h));
  });

  if (!matched) {
    return {
      channel: ch,
      status: CHANNEL_CONNECTION_STATES.NOT_CONFIGURED,
      canSendOutbound: false,
      provider: null,
      detail: `No ${ch} provider integration configured in this location`
    };
  }

  const rawStatus = String(matched.status || '').toLowerCase();
  if (rawStatus === 'pending' || rawStatus === 'pending_approval') {
    return {
      channel: ch,
      status: CHANNEL_CONNECTION_STATES.PENDING_APPROVAL,
      canSendOutbound: false,
      provider: matched.providerKey || matched.provider_key || matched.provider || null,
      detail: 'Provider connection is pending verification or approval'
    };
  }
  if (rawStatus === 'disconnected' || rawStatus === 'revoked') {
    return {
      channel: ch,
      status: CHANNEL_CONNECTION_STATES.DISCONNECTED,
      canSendOutbound: false,
      provider: matched.providerKey || matched.provider_key || matched.provider || null,
      detail: 'Provider integration is disconnected'
    };
  }
  if (rawStatus === 'degraded' || rawStatus === 'error' || rawStatus === 'unavailable') {
    return {
      channel: ch,
      status: CHANNEL_CONNECTION_STATES.TEMPORARILY_UNAVAILABLE,
      canSendOutbound: false,
      provider: matched.providerKey || matched.provider_key || matched.provider || null,
      detail: 'Provider integration is temporarily unavailable'
    };
  }
  if (!sendingEnabled) {
    return {
      channel: ch,
      status: CHANNEL_CONNECTION_STATES.SENDING_DISABLED,
      canSendOutbound: false,
      provider: matched.providerKey || matched.provider_key || matched.provider || null,
      detail: 'Sending is disabled in local/sandbox mode or by workspace policy'
    };
  }

  return {
    channel: ch,
    status: CHANNEL_CONNECTION_STATES.CONNECTED,
    canSendOutbound: true,
    provider: matched.providerKey || matched.provider_key || matched.provider || null,
    detail: 'Provider integration connected'
  };
}

function getZonedParts(date, timeZone = 'UTC') {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
    const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      dayOfWeek: dayMap[parts.weekday] ?? date.getUTCDay(),
      hour: Number(parts.hour) % 24,
      minute: Number(parts.minute) || 0
    };
  } catch {
    return {
      dayOfWeek: date.getUTCDay(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes()
    };
  }
}

export function addBusinessMinutes(startDate, minutesToAdd, policy = {}) {
  const start = new Date(startDate);
  const mins = Math.max(1, Math.floor(Number(minutesToAdd) || 1));
  const bh = policy?.businessHours || policy?.business_hours || {};
  if (!bh.enabled) {
    return new Date(start.getTime() + mins * 60_000);
  }

  const timeZone = policy?.timezone || 'UTC';
  const startHour = Number.isFinite(Number(bh.startHour)) ? Number(bh.startHour) : 9;
  const endHour = Number.isFinite(Number(bh.endHour)) ? Number(bh.endHour) : 17;
  const workingDays = new Set(Array.isArray(bh.days) && bh.days.length > 0 ? bh.days : [1, 2, 3, 4, 5]);
  if (endHour <= startHour || workingDays.size === 0) {
    return new Date(start.getTime() + mins * 60_000);
  }

  let cursor = new Date(start.getTime());
  let remaining = mins;
  let guard = 0;
  // Step in 15-minute or 1-minute increments bounded safely
  while (remaining > 0 && guard < 60 * 24 * 30) {
    guard++;
    const { dayOfWeek, hour } = getZonedParts(cursor, timeZone);
    if (workingDays.has(dayOfWeek) && hour >= startHour && hour < endHour) {
      const step = Math.min(remaining, 5);
      cursor = new Date(cursor.getTime() + step * 60_000);
      remaining -= step;
    } else {
      cursor = new Date(cursor.getTime() + 15 * 60_000);
    }
  }
  return cursor;
}

export function computeSlaDeadlines({ createdAt = new Date(), priority = 'normal', policy = null } = {}) {
  if (!policy) {
    return {
      policyId: null,
      firstResponseDueAt: null,
      nextResponseDueAt: null,
      resolutionDueAt: null
    };
  }
  const targets = (policy.targetsByPriority || policy.targets_by_priority || {})[priority]
    || (policy.targetsByPriority || policy.targets_by_priority || {}).normal
    || { firstResponseMin: 240, nextResponseMin: 480, resolutionMin: 1440 };

  const base = new Date(createdAt);
  return {
    policyId: policy.id || null,
    firstResponseDueAt: addBusinessMinutes(base, targets.firstResponseMin || 240, policy).toISOString(),
    nextResponseDueAt: addBusinessMinutes(base, targets.nextResponseMin || 480, policy).toISOString(),
    resolutionDueAt: addBusinessMinutes(base, targets.resolutionMin || 1440, policy).toISOString()
  };
}

export function evaluateSlaStatus({ conversation, policy = null, now = new Date() } = {}) {
  if (!conversation) return { status: 'none', breached: false, activeDueAt: null };
  if (!policy && !conversation.slaPolicyId && !conversation.slaResolutionDueAt) {
    return { status: 'none', breached: false, activeDueAt: null };
  }

  const nowMs = new Date(now).getTime();
  if (['resolved', 'closed', 'archived'].includes(conversation.status)) {
    const dueMs = conversation.slaResolutionDueAt ? new Date(conversation.slaResolutionDueAt).getTime() : null;
    const resolvedMs = conversation.resolvedAt ? new Date(conversation.resolvedAt).getTime() : nowMs;
    const breached = Boolean(conversation.slaBreached || (dueMs && resolvedMs > dueMs));
    return { status: breached ? 'breached' : 'completed', breached, activeDueAt: conversation.slaResolutionDueAt || null };
  }

  const pauseStatuses = new Set(policy?.pauseStatuses || policy?.pause_statuses || ['waiting_on_customer']);
  if (pauseStatuses.has(conversation.status)) {
    return { status: 'paused', breached: Boolean(conversation.slaBreached), activeDueAt: conversation.slaResolutionDueAt || null };
  }

  const activeDueAt = !conversation.firstResponseAt && conversation.slaFirstResponseDueAt
    ? conversation.slaFirstResponseDueAt
    : (conversation.slaResolutionDueAt || conversation.slaFirstResponseDueAt || null);

  if (!activeDueAt) {
    return { status: 'none', breached: false, activeDueAt: null };
  }

  const dueMs = new Date(activeDueAt).getTime();
  if (nowMs > dueMs) {
    return { status: 'breached', breached: true, activeDueAt };
  }

  const escalationMin = Number(policy?.escalationMinutesBefore || policy?.escalation_minutes_before || 30);
  if (dueMs - nowMs <= escalationMin * 60_000) {
    return { status: 'approaching', breached: false, activeDueAt };
  }

  return { status: 'on_track', breached: false, activeDueAt };
}

const ALLOWED_TEMPLATE_VARS = new Set([
  'customer.firstName',
  'customer.lastName',
  'customer.fullName',
  'customer.company',
  'agency.name',
  'agent.name',
  'ticket.number',
  'ticket.subject'
]);

export function validateSavedReplyTemplate(body) {
  if (typeof body !== 'string' || !body.trim()) {
    return { valid: false, code: 'EMPTY_TEMPLATE', error: 'Saved reply body cannot be empty.', variables: [] };
  }
  if (/<script\b|javascript:/i.test(body)) {
    return { valid: false, code: 'UNSAFE_HTML', error: 'Saved reply cannot contain script tags or javascript URIs.', variables: [] };
  }
  const variables = [];
  const tokenRe = /\{\{([^}]+)\}\}/g;
  let match;
  while ((match = tokenRe.exec(body)) !== null) {
    const key = match[1].trim();
    if (!ALLOWED_TEMPLATE_VARS.has(key)) {
      return {
        valid: false,
        code: 'DISALLOWED_TEMPLATE_VARIABLE',
        error: `Template variable '{{${key}}}' is not in the safe allowlist.`,
        variables: []
      };
    }
    if (!variables.includes(key)) variables.push(key);
  }
  return { valid: true, variables };
}

function escapePlain(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderSafeSavedReply(body, context = {}) {
  const check = validateSavedReplyTemplate(body);
  if (!check.valid) {
    throw Object.assign(new Error(check.error), { code: check.code, status: 400 });
  }
  const map = {
    'customer.firstName': context.customer?.firstName || 'there',
    'customer.lastName': context.customer?.lastName || '',
    'customer.fullName': [context.customer?.firstName, context.customer?.lastName].filter(Boolean).join(' ') || context.customer?.name || 'Customer',
    'customer.company': context.customer?.company || '',
    'agency.name': context.agency?.name || 'Operza Support',
    'agent.name': context.agent?.name || 'Support Team',
    'ticket.number': context.ticket?.ticketNumber || '',
    'ticket.subject': context.ticket?.subject || ''
  };
  return body.replace(/\{\{([^}]+)\}\}/g, (_m, rawKey) => escapePlain(map[rawKey.trim()] ?? ''));
}

export async function buildAiSupportSuggestion({
  messages = [],
  contact = null,
  knowledgeItems = [],
  modelRouter = null,
  aiAdapter = null,
  aiConfig = { enabled: false, hasCredentials: false, consentGranted: false }
} = {}) {
  const redactedMessages = (messages || []).slice(-12).map(m => ({
    direction: m.direction,
    senderType: m.senderType,
    body: typeof m.body === 'string' ? m.body.slice(0, 600) : '',
    createdAt: m.createdAt
  }));

  const safeContext = redactSensitivePayload({
    contact: contact ? { firstName: contact.firstName, lastName: contact.lastName, company: contact.company, status: contact.status } : null,
    messages: redactedMessages,
    knowledgeTitles: (knowledgeItems || []).slice(0, 5).map(k => k.title || k.name)
  });

  if (!aiConfig?.enabled || !aiConfig?.hasCredentials || typeof aiAdapter !== 'function') {
    return {
      aiAvailable: false,
      source: 'unavailable',
      code: 'NO_LIVE_AI_PROVIDER_CONFIGURED',
      message: 'Live AI drafting is unavailable because no AI provider credentials are enabled for this workspace. Agents can compose manually or insert a Saved Reply.',
      suggestionOnly: true,
      autoSend: false,
      requiresHumanApproval: true,
      redactedContextPreview: safeContext,
      draftReply: null,
      summary: null,
      recommendedPriority: null,
      recommendedCategory: null
    };
  }

  const selectedModel = modelRouter?.selectModel?.({ capability: 'chat' }) || { id: 'default' };
  const result = await aiAdapter({ model: selectedModel.id, context: safeContext });
  return {
    aiAvailable: true,
    source: 'live_ai',
    modelId: selectedModel.id,
    suggestionOnly: true,
    autoSend: false,
    requiresHumanApproval: true,
    draftReply: result?.draftReply || null,
    summary: result?.summary || null,
    intent: result?.intent || null,
    sentiment: result?.sentiment || null,
    recommendedCategory: result?.recommendedCategory || null,
    recommendedPriority: result?.recommendedPriority || null,
    nextSteps: Array.isArray(result?.nextSteps) ? result.nextSteps : []
  };
}

export const SUPPORT_WORKFLOW_EVENTS = Object.freeze([
  'conversation.created',
  'conversation.inbound_message',
  'conversation.assigned',
  'conversation.priority_changed',
  'conversation.resolved',
  'ticket.created',
  'ticket.reopened',
  'sla.approaching_breach',
  'sla.breached',
  'customer.replied'
]);

export function buildSupportWorkflowEvent({
  agencyId,
  locationId,
  eventType,
  entityId,
  payload = {},
  sourceEventId = null,
  loopDepth = 0
} = {}) {
  if (!SUPPORT_WORKFLOW_EVENTS.includes(eventType)) {
    throw Object.assign(new Error(`Unsupported support workflow event: ${eventType}`), {
      code: 'INVALID_SUPPORT_EVENT',
      status: 400
    });
  }
  if (loopDepth > 3) {
    throw Object.assign(new Error('Workflow event loop depth exceeded'), {
      code: 'WORKFLOW_LOOP_PREVENTED',
      status: 409
    });
  }
  const keySource = `${agencyId}:${locationId}:${eventType}:${entityId}:${sourceEventId || ''}`;
  const idempotencyKey = `sup_${createHash('sha256').update(keySource).digest('hex').slice(0, 32)}`;
  return {
    eventType,
    agencyId,
    locationId,
    entityId,
    idempotencyKey,
    loopDepth,
    payload: redactSensitivePayload(payload),
    occurredAt: new Date().toISOString()
  };
}
