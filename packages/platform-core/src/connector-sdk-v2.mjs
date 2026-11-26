/**
 * ============================================================================
 * Operza Connector SDK 2.0 — Unified Adapter, Lifecycle & Workflow Contract
 * ============================================================================
 * Standardizes connector metadata, readiness levels, permission scopes,
 * rate-limit / retry / circuit-breaker policies, and Workflow Node Registry 2.0
 * export across all external service adapters.
 */

export const READINESS_LEVELS = Object.freeze([
  'implemented_adapter',
  'unit_tested',
  'sandbox_verified',
  'production_configured',
  'live_verified'
]);

export const ERROR_CLASSES = Object.freeze({
  PERMANENT: 'permanent',
  AUTH_FAILURE: 'auth_failure',
  RATE_LIMIT: 'rate_limit',
  TEMPORARY: 'temporary',
  TIMEOUT: 'timeout',
  INVALID_PAYLOAD: 'invalid_payload'
});

export function classifyProviderError(statusCode, errCode = '') {
  const status = Number(statusCode) || 0;
  if (errCode === 'TIMEOUT' || errCode === 'TimeoutError') return { category: ERROR_CLASSES.TIMEOUT, retryable: true };
  if (status === 401 || status === 403) return { category: ERROR_CLASSES.AUTH_FAILURE, retryable: false };
  if (status === 429) return { category: ERROR_CLASSES.RATE_LIMIT, retryable: true };
  if (status === 400 || status === 422) return { category: ERROR_CLASSES.INVALID_PAYLOAD, retryable: false };
  if (status >= 500 || status === 0) return { category: ERROR_CLASSES.TEMPORARY, retryable: true };
  return { category: ERROR_CLASSES.PERMANENT, retryable: false };
}

function makeConnector(spec) {
  return Object.freeze({
    version: '2.0.0',
    readinessLevel: 'implemented_adapter',
    authStrategy: 'oauth2_pkce',
    requiredScopes: Object.freeze([]),
    requiredCredentials: Object.freeze(['clientId', 'clientSecret']),
    rateLimitPolicy: Object.freeze({ maxRequests: 60, windowMs: 60_000 }),
    retryPolicy: Object.freeze({ maxAttempts: 3, backoff: 'exponential', baseDelayMs: 1000 }),
    timeoutMs: 10_000,
    idempotencyPolicy: 'idempotent_keyed',
    triggers: Object.freeze([]),
    actions: Object.freeze([]),
    webhooks: Object.freeze({ inbound: false, outbound: false }),
    ...spec
  });
}

const DEFAULT_CONNECTORS = [
  makeConnector({
    id: 'stripe',
    name: 'Stripe Connect',
    provider: 'payments.stripe',
    category: 'payments',
    description: 'Payment links, invoice status, customer lookup, refunds, and subscription events.',
    authStrategy: 'api_key',
    readinessLevel: 'sandbox_verified',
    requiredCredentials: ['secretKey', 'webhookSecret'],
    requiredScopes: ['commerce:read', 'commerce:write'],
    webhooks: { inbound: true, outbound: false, signatureHeader: 'stripe-signature' },
    triggers: [
      { id: 'payment_succeeded', name: 'Payment Succeeded', riskLevel: 'medium' },
      { id: 'invoice_paid', name: 'Invoice Paid', riskLevel: 'medium' },
      { id: 'refund_created', name: 'Refund Created', riskLevel: 'high' }
    ],
    actions: [
      { id: 'create_payment_link', name: 'Create Payment Link', riskLevel: 'high', requiresApproval: true },
      { id: 'find_customer', name: 'Find Stripe Customer', riskLevel: 'low' },
      { id: 'check_invoice_status', name: 'Check Invoice Status', riskLevel: 'low' }
    ]
  }),
  makeConnector({
    id: 'twilio',
    name: 'Twilio SMS & Voice',
    provider: 'sms.twilio',
    category: 'communication',
    description: 'A2P-compliant SMS messaging and delivery callbacks.',
    authStrategy: 'basic',
    readinessLevel: 'unit_tested',
    requiredCredentials: ['accountSid', 'authToken'],
    requiredScopes: ['communications:send'],
    webhooks: { inbound: true, outbound: false, signatureHeader: 'x-twilio-signature' },
    triggers: [{ id: 'inbound_sms', name: 'Inbound SMS Received', riskLevel: 'low' }],
    actions: [{ id: 'send_sms', name: 'Send SMS', riskLevel: 'high', requiresApproval: true }]
  }),
  makeConnector({
    id: 'sendgrid',
    name: 'SendGrid Email',
    provider: 'email.sendgrid',
    category: 'communication',
    description: 'Transactional email delivery and engagement webhooks.',
    authStrategy: 'api_key',
    readinessLevel: 'unit_tested',
    requiredCredentials: ['apiKey'],
    requiredScopes: ['communications:send'],
    webhooks: { inbound: true, outbound: false },
    triggers: [{ id: 'email_delivered', name: 'Email Delivered', riskLevel: 'low' }],
    actions: [{ id: 'send_email', name: 'Send Email', riskLevel: 'high', requiresApproval: true }]
  }),
  makeConnector({
    id: 'whatsapp_meta',
    name: 'WhatsApp Business (Meta Cloud)',
    provider: 'whatsapp.meta_cloud',
    category: 'communication',
    description: 'Approved template messaging and Meta Cloud webhooks.',
    authStrategy: 'api_key',
    readinessLevel: 'unit_tested',
    requiredCredentials: ['systemUserToken', 'phoneNumberId'],
    requiredScopes: ['communications:send'],
    webhooks: { inbound: true, outbound: false, signatureHeader: 'x-hub-signature-256' },
    triggers: [{ id: 'inbound_whatsapp', name: 'Inbound WhatsApp Message', riskLevel: 'low' }],
    actions: [{ id: 'send_template', name: 'Send WhatsApp Template', riskLevel: 'high', requiresApproval: true }]
  }),
  makeConnector({
    id: 'microsoft_outlook',
    name: 'Microsoft Outlook & Calendar',
    provider: 'microsoft.graph',
    category: 'crm',
    description: 'OAuth 2.0 PKCE mail dispatch and two-way calendar event sync.',
    authStrategy: 'oauth2_pkce',
    readinessLevel: 'unit_tested',
    requiredScopes: ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Mail.Send', 'Calendars.ReadWrite'],
    triggers: [{ id: 'calendar_event_changed', name: 'Calendar Event Changed', riskLevel: 'low' }],
    actions: [
      { id: 'send_email', name: 'Send Outlook Email', riskLevel: 'high', requiresApproval: true },
      { id: 'create_event', name: 'Create Calendar Event', riskLevel: 'medium' }
    ]
  }),
  makeConnector({
    id: 'google_sheets',
    name: 'Google Sheets',
    provider: 'google.sheets',
    category: 'crm',
    description: 'Append, lookup, and synchronize CRM rows with Google Sheets.',
    authStrategy: 'oauth2_pkce',
    readinessLevel: 'implemented_adapter',
    requiredScopes: ['https://www.googleapis.com/auth/spreadsheets'],
    triggers: [{ id: 'row_added', name: 'Spreadsheet Row Added', riskLevel: 'low' }],
    actions: [
      { id: 'append_row', name: 'Append Row', riskLevel: 'medium' },
      { id: 'find_row', name: 'Find Row', riskLevel: 'low' }
    ]
  }),
  makeConnector({
    id: 'hubspot',
    name: 'HubSpot CRM',
    provider: 'hubspot.crm',
    category: 'crm',
    description: 'Loop-safe contact and deal synchronization with HubSpot.',
    authStrategy: 'oauth2_pkce',
    readinessLevel: 'implemented_adapter',
    requiredScopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'],
    triggers: [{ id: 'contact_updated', name: 'HubSpot Contact Updated', riskLevel: 'low' }],
    actions: [
      { id: 'upsert_contact', name: 'Create or Update Contact', riskLevel: 'medium' },
      { id: 'find_contact', name: 'Find Contact', riskLevel: 'low' }
    ]
  }),
  makeConnector({
    id: 'slack',
    name: 'Slack',
    provider: 'slack.web',
    category: 'automation',
    description: 'Channel alerts and team notifications via Slack OAuth.',
    authStrategy: 'oauth2_pkce',
    readinessLevel: 'implemented_adapter',
    requiredScopes: ['chat:write', 'channels:read'],
    triggers: [{ id: 'channel_message', name: 'Channel Message', riskLevel: 'low' }],
    actions: [{ id: 'post_message', name: 'Post Channel Message', riskLevel: 'medium' }]
  }),
  makeConnector({
    id: 'generic_webhook',
    name: 'Signed HTTPS Webhook',
    provider: 'operza.webhook',
    category: 'developer',
    description: 'SSRF-guarded HMAC-SHA256 inbound and outbound webhooks.',
    authStrategy: 'webhook_secret',
    readinessLevel: 'unit_tested',
    requiredCredentials: ['signingSecret'],
    webhooks: { inbound: true, outbound: true, signatureHeader: 'x-operza-signature' },
    triggers: [{ id: 'webhook_received', name: 'Signed Webhook Received', riskLevel: 'medium' }],
    actions: [{ id: 'dispatch_webhook', name: 'Send Signed Webhook', riskLevel: 'high', requiresApproval: false }]
  })
];

export function createConnectorSdkV2({ extraConnectors = [] } = {}) {
  const connectors = new Map();
  const circuitBreakers = new Map();

  for (const c of [...DEFAULT_CONNECTORS, ...extraConnectors]) {
    connectors.set(c.id, c);
  }

  return {
    register(spec) {
      if (!spec?.id) throw Object.assign(new TypeError('Connector id required'), { code: 'INVALID_CONNECTOR' });
      const normalized = makeConnector(spec);
      connectors.set(normalized.id, normalized);
      return normalized;
    },

    get(id) {
      return connectors.get(id) || null;
    },

    list({ category = 'all', search = '' } = {}) {
      let items = [...connectors.values()];
      if (category && category !== 'all') {
        items = items.filter(c => c.category === category);
      }
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        items = items.filter(
          c => c.id.toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q) ||
            c.description.toLowerCase().includes(q)
        );
      }
      return items;
    },

    exportWorkflowNodes({ grantedScopes = null } = {}) {
      const exported = [];
      for (const c of connectors.values()) {
        const allowed = !grantedScopes || c.requiredScopes.every(s => grantedScopes.includes(s) || grantedScopes.includes('*'));
        if (!allowed) continue;
        for (const trig of c.triggers) {
          exported.push({
            nodeType: `connector.${c.id}.trigger.${trig.id}`,
            connectorId: c.id,
            category: 'triggers',
            displayName: `${c.name}: ${trig.name}`,
            riskLevel: trig.riskLevel || 'low',
            requiredPermissions: c.requiredScopes,
            readinessLevel: c.readinessLevel
          });
        }
        for (const act of c.actions) {
          exported.push({
            nodeType: `connector.${c.id}.action.${act.id}`,
            connectorId: c.id,
            category: 'integrations',
            displayName: `${c.name}: ${act.name}`,
            riskLevel: act.riskLevel || 'medium',
            requiresApproval: Boolean(act.requiresApproval),
            requiredPermissions: c.requiredScopes,
            timeoutMs: c.timeoutMs,
            retryPolicy: c.retryPolicy,
            idempotencyPolicy: c.idempotencyPolicy,
            readinessLevel: c.readinessLevel
          });
        }
      }
      return exported;
    },

    recordOutcome(connectionId, ok) {
      const state = circuitBreakers.get(connectionId) || { failures: 0, openUntil: 0 };
      if (ok) {
        circuitBreakers.set(connectionId, { failures: 0, openUntil: 0 });
        return { circuitState: 'closed', failures: 0 };
      }
      const failures = state.failures + 1;
      const openUntil = failures >= 5 ? Date.now() + 60_000 : 0;
      circuitBreakers.set(connectionId, { failures, openUntil });
      return { circuitState: openUntil > 0 ? 'open' : 'closed', failures, openUntil };
    },

    isCircuitOpen(connectionId, now = Date.now()) {
      const state = circuitBreakers.get(connectionId);
      return Boolean(state && state.openUntil > now);
    }
  };
}
