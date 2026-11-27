import { createHash } from 'node:crypto';

export const CONVERSATION_STATUSES = Object.freeze(['open', 'assigned', 'pending', 'resolved', 'archived']);
const CONVERSATION_TRANSITIONS = Object.freeze({
  open: new Set(['assigned', 'pending', 'resolved', 'archived']),
  assigned: new Set(['open', 'pending', 'resolved', 'archived']),
  pending: new Set(['open', 'assigned', 'resolved', 'archived']),
  resolved: new Set(['open', 'assigned', 'archived']),
  archived: new Set(['open'])
});

export function canTransitionConversation(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  return Boolean(CONVERSATION_TRANSITIONS[fromStatus]?.has(toStatus));
}

export const MESSAGE_DELIVERY_STATES = Object.freeze([
  'draft',
  'queued',
  'submitted',
  'sent',
  'delivered',
  'failed',
  'inbound'
]);

const MESSAGE_STATE_TRANSITIONS = Object.freeze({
  draft: new Set(['queued', 'failed']),
  queued: new Set(['submitted', 'sent', 'failed']),
  submitted: new Set(['sent', 'delivered', 'failed']),
  sent: new Set(['delivered', 'failed']),
  delivered: new Set([]),
  failed: new Set(['queued']),
  inbound: new Set([])
});

export function canTransitionMessageState(fromState, toState, { viaProviderCallback = false } = {}) {
  if (toState === 'delivered' && !viaProviderCallback) {
    return false;
  }
  return Boolean(MESSAGE_STATE_TRANSITIONS[fromState]?.has(toState));
}

export const CAMPAIGN_STATUSES = Object.freeze([
  'draft',
  'ready_for_review',
  'approved',
  'scheduled',
  'sending',
  'paused',
  'completed',
  'failed',
  'cancelled'
]);

const CAMPAIGN_TRANSITIONS = Object.freeze({
  draft: new Set(['ready_for_review', 'cancelled']),
  ready_for_review: new Set(['approved', 'draft', 'cancelled']),
  approved: new Set(['scheduled', 'sending', 'cancelled']),
  scheduled: new Set(['sending', 'paused', 'cancelled']),
  sending: new Set(['paused', 'completed', 'failed', 'cancelled']),
  paused: new Set(['sending', 'cancelled']),
  completed: new Set([]),
  failed: new Set(['draft', 'cancelled']),
  cancelled: new Set([])
});

export function canTransitionCampaign(fromStatus, toStatus) {
  return Boolean(CAMPAIGN_TRANSITIONS[fromStatus]?.has(toStatus));
}

const ALLOWED_TEMPLATE_VARS = new Set([
  'contact.first_name',
  'contact.last_name',
  'contact.full_name',
  'contact.company',
  'contact.email',
  'owner.name',
  'appointment.date',
  'appointment.time'
]);

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function extractTemplateVariables(text = '') {
  const matches = new Set();
  const re = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(String(text))) !== null) {
    matches.add(m[1]);
  }
  return [...matches];
}

export function validateTemplate({ channel, body, approvalStatus = 'draft', providerTemplateId = null } = {}) {
  if (!['email', 'sms', 'whatsapp', 'internal_notification'].includes(channel)) {
    return { valid: false, code: 'INVALID_CHANNEL', error: `Unsupported template channel: ${channel}` };
  }
  if (!body || typeof body !== 'string' || !body.trim()) {
    return { valid: false, code: 'EMPTY_BODY', error: 'Template body is required' };
  }
  if (/<\s*script\b|javascript:/i.test(body)) {
    return { valid: false, code: 'UNSAFE_TEMPLATE_CONTENT', error: 'Executable script or javascript: URLs are forbidden' };
  }
  const vars = extractTemplateVariables(body);
  for (const v of vars) {
    if (!ALLOWED_TEMPLATE_VARS.has(v) && !v.startsWith('custom.')) {
      return { valid: false, code: 'UNKNOWN_TEMPLATE_VARIABLE', error: `Unapproved template variable: ${v}` };
    }
  }
  if (channel === 'whatsapp' && approvalStatus === 'approved' && !providerTemplateId) {
    return { valid: false, code: 'WHATSAPP_PROVIDER_APPROVAL_REQUIRED', error: 'WhatsApp templates require a provider_template_id to be marked approved' };
  }
  return { valid: true, variables: vars };
}

export function renderSafeTemplate({ channel, body, context = {} } = {}) {
  const validation = validateTemplate({ channel, body });
  if (!validation.valid) {
    throw Object.assign(new Error(validation.error), { code: validation.code });
  }
  const lookup = (pathKey) => {
    const parts = pathKey.split('.');
    let cur = context;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, p)) {
        cur = cur[p];
      } else {
        return '';
      }
    }
    const raw = String(cur ?? '');
    if (/javascript:/i.test(raw)) return '';
    return channel === 'email' ? escapeHtml(raw) : raw.replace(/[\r\n]+/g, ' ').trim();
  };
  return String(body).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => lookup(key));
}

export function isWithinQuietHours({ now = new Date(), timezone = 'UTC', startHour = 8, endHour = 20 } = {}) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false
  });
  const hour = Number(formatter.format(now)) % 24;
  return hour < startHour || hour >= endHour;
}

export function evaluateRecipientEligibility({
  contact,
  channel,
  purpose = 'marketing',
  suppressions = [],
  consents = [],
  recentSendCount = 0,
  maxSendsPerWindow = 3,
  now = new Date(),
  timezone = 'UTC',
  sendWindow = { startHour: 8, endHour: 20 }
} = {}) {
  if (!contact || !contact.id) {
    return { eligible: false, code: 'MISSING_CONTACT' };
  }
  const identifier = channel === 'email' ? contact.email?.toLowerCase() : contact.phone;
  const suppressed = suppressions.some(
    (s) => (s.channel === channel || s.channel === 'all') &&
      ((s.contactId && s.contactId === contact.id) || (identifier && s.identifier?.toLowerCase() === identifier.toLowerCase()))
  );
  if (suppressed) {
    return { eligible: false, code: 'SUPPRESSED_CONTACT' };
  }
  const channelConsents = consents
    .filter((c) => c.contactId === contact.id && c.channel === channel)
    .sort((a, b) => String(b.capturedAt || '').localeCompare(String(a.capturedAt || '')));
  if (channelConsents.length === 0) {
    if (purpose === 'marketing') return { eligible: false, code: 'CONSENT_REQUIRED' };
  } else {
    const latest = channelConsents[0];
    if (latest.status === 'revoked') return { eligible: false, code: 'CONSENT_REVOKED' };
    if (latest.expiresAt && new Date(latest.expiresAt).getTime() <= now.getTime()) {
      return { eligible: false, code: 'CONSENT_EXPIRED' };
    }
  }
  if (recentSendCount >= maxSendsPerWindow) {
    return { eligible: false, code: 'FREQUENCY_CAP_REACHED' };
  }
  if (channel !== 'internal_notification' && isWithinQuietHours({ now, timezone, startHour: sendWindow.startHour ?? 8, endHour: sendWindow.endHour ?? 20 })) {
    return { eligible: false, code: 'QUIET_HOURS_ACTIVE' };
  }
  return { eligible: true, code: 'ELIGIBLE' };
}

export function buildRecipientIdempotencyKey({ agencyId, locationId, campaignId, contactId }) {
  return createHash('sha256')
    .update(`${agencyId}:${locationId}:${campaignId}:${contactId}`)
    .digest('hex')
    .slice(0, 32);
}

export function classifyProviderDeliveryError(statusCode, errorCode = '') {
  if ([400, 401, 403, 404, 422].includes(Number(statusCode))) {
    return { retryable: false, classification: 'permanent_provider_error', code: errorCode || `HTTP_${statusCode}` };
  }
  if (Number(statusCode) === 429 || Number(statusCode) >= 500) {
    return { retryable: true, classification: 'transient_provider_error', code: errorCode || `HTTP_${statusCode}` };
  }
  return { retryable: false, classification: 'unknown_error', code: errorCode || 'PROVIDER_ERROR' };
}

export function generateAiInboxSuggestion({
  messages = [],
  contact = null,
  kbSnippets = [],
  autoSendPolicyEnabled = false
} = {}) {
  const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound') || messages[messages.length - 1];
  const text = String(lastInbound?.body || '').toLowerCase();

  let intent = 'general_inquiry';
  let sentiment = 'neutral';
  let recommendedAction = 'reply_with_context';

  if (/\b(stop|unsubscribe|cancel|opt out)\b/.test(text)) {
    intent = 'opt_out_request';
    sentiment = 'negative';
    recommendedAction = 'suppress_and_confirm_opt_out';
  } else if (/\b(price|pricing|quote|cost|demo|book)\b/.test(text)) {
    intent = 'sales_buying_intent';
    sentiment = 'positive';
    recommendedAction = 'share_booking_or_pricing';
  } else if (/\b(broken|issue|error|refund|angry|complaint)\b/.test(text)) {
    intent = 'support_escalation';
    sentiment = 'negative';
    recommendedAction = 'assign_senior_support';
  }

  const topKb = kbSnippets[0] || null;
  const citations = topKb ? [{ docId: topKb.id || 'kb-1', title: topKb.title || 'Knowledge Base' }] : [];
  const greeting = contact?.firstName ? `Hi ${contact.firstName}, ` : 'Hello, ';
  const suggestedReply =
    intent === 'opt_out_request'
      ? `${greeting}we have updated your communication preferences and removed you from future outreach.`
      : topKb
      ? `${greeting}thanks for reaching out. Based on our guide (${topKb.title || 'Help Center'}): ${String(topKb.excerpt || topKb.content || '').slice(0, 140)}`
      : `${greeting}thank you for your message. A team member will follow up with the exact details shortly.`;

  return {
    isAiSuggestion: true,
    requiresHumanApproval: !autoSendPolicyEnabled || intent === 'opt_out_request',
    autoSendAllowed: Boolean(autoSendPolicyEnabled && intent !== 'opt_out_request'),
    intent,
    sentiment,
    recommendedAction,
    summary: `Latest message (${lastInbound?.channel || 'sms'}): ${intent.replace(/_/g, ' ')} (${sentiment} sentiment).`,
    suggestedReply,
    citations
  };
}

export const ENGAGEMENT_METRIC_DEFINITIONS = Object.freeze({
  conversations_opened: {
    numerator: 'COUNT(conversations)',
    denominator: '1',
    dateField: 'created_at',
    source: 'conversations'
  },
  first_response_time_seconds: {
    numerator: 'AVG(EXTRACT(EPOCH FROM (first_outbound.created_at - first_inbound.created_at)))',
    denominator: 'COUNT(conversations with >=1 inbound & >=1 outbound)',
    dateField: 'first_inbound.created_at',
    source: 'messages'
  },
  delivery_rate: {
    numerator: "COUNT(recipients WHERE delivery_state = 'delivered')",
    denominator: "COUNT(recipients WHERE delivery_state IN ('sent','delivered','failed'))",
    dateField: 'updated_at',
    source: 'engagement_campaign_recipients'
  },
  unsubscribe_rate: {
    numerator: "COUNT(suppression WHERE reason = 'opt_out')",
    denominator: 'COUNT(eligible_recipients)',
    dateField: 'created_at',
    source: 'engagement_suppression_list'
  }
});
