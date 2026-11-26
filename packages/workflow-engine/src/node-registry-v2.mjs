/**
 * ============================================================================
 * Operza Workflow Builder 2.0 — Extensible Node Registry & Schema Validator
 * ============================================================================
 * Defines typed metadata, schemas, permissions, risk levels, timeout/retry
 * policies, idempotency semantics, and credential requirements for all 7
 * workflow node categories. Strictly forbids arbitrary JS or raw SQL nodes.
 */

const SECRET_KEY_RE = /(password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|client[_-]?secret)/i;
const FORBIDDEN_CODE_RE = /(\beval\s*\(|\bnew\s+Function\b|__proto__|constructor\s*\(|process\.env|require\s*\()/i;

function def(spec) {
  return Object.freeze({
    version: 1,
    timeoutMs: 15_000,
    retryPolicy: Object.freeze({ maxAttempts: 3, backoff: 'exponential', baseDelayMs: 1000 }),
    idempotencyBehavior: 'idempotent_keyed',
    credentialRequirements: Object.freeze([]),
    requiredPermissions: Object.freeze(['workflows:execute']),
    inputSchema: Object.freeze({ type: 'object' }),
    outputSchema: Object.freeze({ type: 'object' }),
    configSchema: Object.freeze({ type: 'object', properties: {}, required: [] }),
    uiMetadata: Object.freeze({ icon: 'zap', color: '#6366f1', handles: { inputs: 1, outputs: ['default'] } }),
    ...spec
  });
}

const NODE_DEFINITIONS = [
  // A. Triggers
  def({ type: 'manual', displayName: 'Manual Trigger', description: 'Starts workflow manually from CRM or API', category: 'triggers', riskLevel: 'low', idempotencyBehavior: 'non_idempotent_run_id', uiMetadata: { icon: 'play', color: '#4f46e5', handles: { inputs: 0, outputs: ['default'] } } }),
  def({ type: 'webhook', displayName: 'Webhook Trigger', description: 'Starts when an authenticated inbound webhook arrives', category: 'triggers', riskLevel: 'medium', uiMetadata: { icon: 'webhook', color: '#ec4899', handles: { inputs: 0, outputs: ['default'] } } }),
  def({ type: 'schedule', displayName: 'Schedule Trigger', description: 'Runs on a UTC / IANA timezone schedule', category: 'triggers', riskLevel: 'low', configSchema: { type: 'object', properties: { timezone: { type: 'string' }, scheduleType: { type: 'string' } }, required: [] }, uiMetadata: { icon: 'clock', color: '#f59e0b', handles: { inputs: 0, outputs: ['default'] } } }),
  def({ type: 'contact_created', displayName: 'Contact Created', description: 'Fires when a new CRM contact is created', category: 'triggers', riskLevel: 'low', uiMetadata: { icon: 'user', color: '#10b981', handles: { inputs: 0, outputs: ['default'] } } }),
  def({ type: 'contact_updated', displayName: 'Contact Updated', description: 'Fires when CRM contact attributes change', category: 'triggers', riskLevel: 'low', uiMetadata: { icon: 'user', color: '#10b981', handles: { inputs: 0, outputs: ['default'] } } }),
  def({ type: 'contact_tag_changed', displayName: 'Contact Tag Changed', description: 'Fires when a tag is added or removed on a contact', category: 'triggers', riskLevel: 'low', uiMetadata: { icon: 'tag', color: '#8b5cf6', handles: { inputs: 0, outputs: ['default'] } } }),
  def({ type: 'opportunity_created', displayName: 'Opportunity Created', description: 'Fires when a pipeline deal is created', category: 'triggers', riskLevel: 'low', uiMetadata: { icon: 'dollar', color: '#06b6d4', handles: { inputs: 0, outputs: ['default'] } } }),
  def({ type: 'opportunity_stage', displayName: 'Opportunity Stage Changed', description: 'Fires when a deal moves between pipeline stages', category: 'triggers', riskLevel: 'low', uiMetadata: { icon: 'sliders', color: '#06b6d4', handles: { inputs: 0, outputs: ['default'] } } }),
  def({ type: 'form', displayName: 'Form Submitted', description: 'Fires when a contact submits a tracked form', category: 'triggers', riskLevel: 'low', uiMetadata: { icon: 'clipboard', color: '#3b82f6', handles: { inputs: 0, outputs: ['default'] } } }),
  def({ type: 'appointment', displayName: 'Appointment Booked', description: 'Fires when a calendar appointment is scheduled', category: 'triggers', riskLevel: 'low', uiMetadata: { icon: 'calendar', color: '#3b82f6', handles: { inputs: 0, outputs: ['default'] } } }),
  def({ type: 'payment', displayName: 'Payment Event', description: 'Fires on invoice/order payment state changes', category: 'triggers', riskLevel: 'medium', uiMetadata: { icon: 'wallet', color: '#10b981', handles: { inputs: 0, outputs: ['default'] } } }),
  def({ type: 'conversation_event', displayName: 'Conversation Event', description: 'Fires on inbound customer message or status change', category: 'triggers', riskLevel: 'low', uiMetadata: { icon: 'message', color: '#6366f1', handles: { inputs: 0, outputs: ['default'] } } }),
  def({ type: 'integration_event', displayName: 'Integration SDK Event', description: 'Fires from a registered Integration SDK connector webhook/poll', category: 'triggers', riskLevel: 'medium', uiMetadata: { icon: 'plug', color: '#ec4899', handles: { inputs: 0, outputs: ['default'] } } }),

  // B. CRM 2.0 Actions
  def({ type: 'create_contact', displayName: 'Create Contact', description: 'Creates a contact via CRM repository with deduplication', category: 'crm', riskLevel: 'medium', requiredPermissions: ['contacts:write'], configSchema: { type: 'object', properties: { firstName: { type: 'string' }, lastName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } }, required: [] } }),
  def({ type: 'update_contact', displayName: 'Update Contact', description: 'Updates CRM contact fields', category: 'crm', riskLevel: 'medium', requiredPermissions: ['contacts:write'] }),
  def({ type: 'find_contact', displayName: 'Find Contact', description: 'Looks up a CRM contact by email, phone, or ID', category: 'crm', riskLevel: 'low', requiredPermissions: ['contacts:read'] }),
  def({ type: 'tag', displayName: 'Add Tag', description: 'Applies one or more tags to a contact', category: 'crm', riskLevel: 'low', requiredPermissions: ['contacts:write'], configSchema: { type: 'object', properties: { tag: { type: 'string', minLength: 1 } }, required: [] } }),
  def({ type: 'remove_tag', displayName: 'Remove Tag', description: 'Removes a tag from a contact', category: 'crm', riskLevel: 'low', requiredPermissions: ['contacts:write'] }),
  def({ type: 'lifecycle_stage', displayName: 'Change Lifecycle Stage', description: 'Transitions contact lifecycle stage', category: 'crm', riskLevel: 'medium', requiredPermissions: ['contacts:write'] }),
  def({ type: 'assign_to', displayName: 'Assign Owner', description: 'Assigns contact or opportunity owner', category: 'crm', riskLevel: 'low', requiredPermissions: ['contacts:write'] }),
  def({ type: 'create_opportunity', displayName: 'Create Opportunity', description: 'Creates a pipeline opportunity for the contact', category: 'crm', riskLevel: 'medium', requiredPermissions: ['opportunities:write'] }),
  def({ type: 'opportunity_stage', displayName: 'Move Opportunity Stage', description: 'Moves an opportunity to another pipeline stage', category: 'crm', riskLevel: 'medium', requiredPermissions: ['opportunities:write'] }),
  def({ type: 'task', displayName: 'Create Task', description: 'Creates a follow-up CRM task', category: 'crm', riskLevel: 'low', requiredPermissions: ['tasks:write'] }),
  def({ type: 'create_note', displayName: 'Create Note', description: 'Appends a note to the contact timeline', category: 'crm', riskLevel: 'low', requiredPermissions: ['contacts:write'] }),

  // C. Communication Actions
  def({ type: 'email', displayName: 'Send Email', description: 'Sends transactional email respecting consent and provider status', category: 'communication', riskLevel: 'high', requiredPermissions: ['communications:send'], credentialRequirements: ['sendgrid'], idempotencyBehavior: 'at_least_once_provider_dedup' }),
  def({ type: 'sms', displayName: 'Send SMS', description: 'Sends SMS via verified A2P provider respecting opt-in consent', category: 'communication', riskLevel: 'high', requiredPermissions: ['communications:send'], credentialRequirements: ['twilio'], idempotencyBehavior: 'at_least_once_provider_dedup' }),
  def({ type: 'whatsapp', displayName: 'Send WhatsApp', description: 'Sends approved WhatsApp template/session message', category: 'communication', riskLevel: 'high', requiredPermissions: ['communications:send'], credentialRequirements: ['whatsapp'], idempotencyBehavior: 'at_least_once_provider_dedup' }),
  def({ type: 'create_conversation', displayName: 'Create Conversation', description: 'Opens or updates an omnichannel conversation thread', category: 'communication', riskLevel: 'medium', requiredPermissions: ['conversations:write'] }),
  def({ type: 'internal_notification', displayName: 'Send Internal Notification', description: 'Notifies internal workspace members without external messaging', category: 'communication', riskLevel: 'low', requiredPermissions: ['notifications:write'] }),

  // D. Logic & Control Flow
  def({ type: 'condition', displayName: 'If / Else', description: 'Deterministic conditional branching (YES / NO)', category: 'logic', riskLevel: 'low', uiMetadata: { icon: 'sliders', color: '#f97316', handles: { inputs: 1, outputs: ['yes', 'no'] } } }),
  def({ type: 'switch', displayName: 'Multi-Branch Switch', description: 'Routes execution across named cases and default fallback', category: 'logic', riskLevel: 'low', uiMetadata: { icon: 'sliders', color: '#f59e0b', handles: { inputs: 1, outputs: ['case_1', 'case_2', 'default'] } } }),
  def({ type: 'and_or_condition', displayName: 'AND / OR Conditions', description: 'Compound boolean rule group evaluator', category: 'logic', riskLevel: 'low', uiMetadata: { icon: 'filter', color: '#f97316', handles: { inputs: 1, outputs: ['yes', 'no'] } } }),
  def({ type: 'wait', displayName: 'Wait / Delay', description: 'Durable timer pause persisted in PostgreSQL wait state', category: 'logic', riskLevel: 'low', timeoutMs: 5000 }),
  def({ type: 'schedule_delay', displayName: 'Schedule Window', description: 'Waits until a specific timezone-aware window', category: 'logic', riskLevel: 'low' }),
  def({ type: 'loop_items', displayName: 'Bounded Loop', description: 'Iterates array items with strict maxLoopIterations cap', category: 'logic', riskLevel: 'medium', configSchema: { type: 'object', properties: { maxIterations: { type: 'number' }, batchSize: { type: 'number' } }, required: [] } }),
  def({ type: 'split_branches', displayName: 'Parallel Split', description: 'Fans out into bounded parallel execution branches', category: 'logic', riskLevel: 'medium', uiMetadata: { icon: 'share', color: '#6366f1', handles: { inputs: 1, outputs: ['branch_a', 'branch_b'] } } }),
  def({ type: 'merge', displayName: 'Merge Branches', description: 'Joins parallel branches using all or any barrier semantics', category: 'logic', riskLevel: 'low', configSchema: { type: 'object', properties: { mode: { type: 'string' } }, required: [] } }),
  def({ type: 'stop', displayName: 'Stop Workflow', description: 'Terminates the current branch or workflow execution cleanly', category: 'logic', riskLevel: 'low', uiMetadata: { icon: 'square', color: '#ef4444', handles: { inputs: 1, outputs: [] } } }),
  def({ type: 'approval_gate', displayName: 'Human Approval Gate', description: 'Pauses execution until an authorized human approves or rejects', category: 'logic', riskLevel: 'high', requiredPermissions: ['approvals:request'] }),
  def({ type: 'sub_workflow', displayName: 'Sub-Workflow', description: 'Invokes a published child workflow with depth guard', category: 'logic', riskLevel: 'medium', requiredPermissions: ['workflows:execute'] }),

  // E. Data Operations (Deterministic, Zero Arbitrary Code/SQL)
  def({ type: 'set_variable', displayName: 'Set Variable', description: 'Assigns typed workflow context variables', category: 'data', riskLevel: 'low' }),
  def({ type: 'map_fields', displayName: 'Map Fields', description: 'Maps source fields to normalized target schema', category: 'data', riskLevel: 'low' }),
  def({ type: 'format_data', displayName: 'Format Data', description: 'Applies safe formatting templates without eval', category: 'data', riskLevel: 'low' }),
  def({ type: 'validate_data', displayName: 'Validate Data', description: 'Validates payload fields against type constraints', category: 'data', riskLevel: 'low' }),
  def({ type: 'convert_types', displayName: 'Convert Types', description: 'Converts string/number/boolean/ISO date types', category: 'data', riskLevel: 'low' }),
  def({ type: 'parse_json', displayName: 'Parse JSON', description: 'Safely parses bounded JSON string with prototype guard', category: 'data', riskLevel: 'low' }),
  def({ type: 'date_time', displayName: 'Date & Time', description: 'Computes timezone-aware date arithmetic', category: 'data', riskLevel: 'low' }),
  def({ type: 'string_transform', displayName: 'String Transform', description: 'Safe trim, case, replace, and slugify transforms', category: 'data', riskLevel: 'low' }),
  def({ type: 'filter_array', displayName: 'Filter Array', description: 'Filters bounded arrays using declarative predicates', category: 'data', riskLevel: 'low' }),

  // F. Commerce
  def({ type: 'create_payment_link', displayName: 'Create Payment Link', description: 'Generates a Stripe Connect checkout/payment link', category: 'commerce', riskLevel: 'high', requiredPermissions: ['commerce:write'], credentialRequirements: ['stripe'] }),
  def({ type: 'find_invoice', displayName: 'Find Invoice', description: 'Queries tenant invoice record', category: 'commerce', riskLevel: 'low', requiredPermissions: ['commerce:read'] }),
  def({ type: 'check_payment_status', displayName: 'Check Payment Status', description: 'Checks authoritative ledger payment status', category: 'commerce', riskLevel: 'low', requiredPermissions: ['commerce:read'] }),
  def({ type: 'apply_coupon', displayName: 'Apply Coupon', description: 'Applies a validated discount coupon to an order/invoice', category: 'commerce', riskLevel: 'high', requiredPermissions: ['commerce:write'] }),
  def({ type: 'create_order', displayName: 'Create Order', description: 'Creates an order record with idempotency and approval checks', category: 'commerce', riskLevel: 'high', requiredPermissions: ['commerce:write'] }),

  // G. AI Operations (Governed by Phase 5 AI Platform)
  def({ type: 'ai_generate', displayName: 'AI Text Generation', description: 'Generates text via governed Phase 5 model router', category: 'ai', riskLevel: 'medium', requiredPermissions: ['ai:execute'], timeoutMs: 30_000 }),
  def({ type: 'ai_classify', displayName: 'AI Classification', description: 'Classifies input text into constrained categories', category: 'ai', riskLevel: 'low', requiredPermissions: ['ai:execute'], timeoutMs: 20_000 }),
  def({ type: 'ai_summarize', displayName: 'AI Summarization', description: 'Summarizes conversation or timeline text', category: 'ai', riskLevel: 'low', requiredPermissions: ['ai:execute'], timeoutMs: 25_000 }),
  def({ type: 'ai_extract', displayName: 'AI Data Extraction', description: 'Extracts typed JSON fields from unstructured text', category: 'ai', riskLevel: 'medium', requiredPermissions: ['ai:execute'], timeoutMs: 25_000 }),
  def({ type: 'ai_decision', displayName: 'AI Structured Decision', description: 'Produces schema-validated routing decision without bypassing governance', category: 'ai', riskLevel: 'medium', requiredPermissions: ['ai:execute'], timeoutMs: 25_000 }),
  def({ type: 'ai_kb_retrieve', displayName: 'AI Knowledge Retrieval', description: 'Queries tenant pgvector RAG knowledge base', category: 'ai', riskLevel: 'low', requiredPermissions: ['ai:read'], timeoutMs: 15_000 }),
  def({ type: 'ai_agent', displayName: 'Approved AI Agent', description: 'Invokes an approved AI agent within tool-permission boundaries', category: 'ai', riskLevel: 'high', requiredPermissions: ['ai:agent:execute'], timeoutMs: 45_000 }),

  // Integration / Webhook outbound
  def({ type: 'webhook_outbound', displayName: 'Outbound Webhook', description: 'Sends SSRF-checked signed webhook payload', category: 'communication', riskLevel: 'high', requiredPermissions: ['integrations:execute'] }),
  def({ type: 'webhook_respond', displayName: 'Webhook Respond', description: 'Sends synchronous HTTP response for webhook-triggered flow', category: 'logic', riskLevel: 'low' }),
  def({ type: 'wait_webhook', displayName: 'Wait for Webhook', description: 'Pauses until signed resume callback arrives', category: 'logic', riskLevel: 'low' }),
  def({ type: 'zapier', displayName: 'Integration / Zapier Hook', description: 'Dispatches event through registered Integration SDK adapter', category: 'communication', riskLevel: 'high', requiredPermissions: ['integrations:execute'] })
];

const REGISTRY_BY_TYPE = new Map(NODE_DEFINITIONS.map(d => [d.type, d]));

export const NODE_REGISTRY_V2 = Object.freeze(NODE_DEFINITIONS);

export function getNodeDefinitionV2(type) {
  if (typeof type !== 'string') return null;
  return REGISTRY_BY_TYPE.get(type.trim()) || null;
}

export function listNodeDefinitionsV2({ category, search } = {}) {
  let list = NODE_DEFINITIONS;
  if (category && category !== 'all') {
    list = list.filter(item => item.category === category);
  }
  if (search && typeof search === 'string' && search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter(
      item => item.type.toLowerCase().includes(q) ||
        item.displayName.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
    );
  }
  return list;
}

function scanConfigValue(value, path, errors) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (FORBIDDEN_CODE_RE.test(value)) {
      errors.push({ code: 'UNSAFE_EXPRESSION', path, message: `${path} contains forbidden executable code pattern` });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, idx) => scanConfigValue(entry, `${path}[${idx}]`, errors));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(k)) {
        errors.push({ code: 'PROTOTYPE_POLLUTION_KEY', path: `${path}.${k}`, message: `Unsafe key "${k}"` });
      } else if (SECRET_KEY_RE.test(k)) {
        errors.push({ code: 'CREDENTIAL_IN_CONFIG', path: `${path}.${k}`, message: `Credential-like key "${k}" must use secret vault reference` });
      }
      scanConfigValue(v, `${path}.${k}`, errors);
    }
  }
}

export function validateNodeConfigV2(type, config = {}) {
  const errors = [];
  if (type === 'code' || type === 'raw_sql' || type === 'eval') {
    errors.push({ code: 'UNSAFE_NODE_TYPE', path: 'type', message: `Node type "${type}" is forbidden in Workflow 2.0` });
    return { valid: false, errors };
  }
  const defItem = getNodeDefinitionV2(type);
  if (!defItem) {
    errors.push({ code: 'UNKNOWN_NODE_TYPE', path: 'type', message: `Unsupported node type "${type}"` });
    return { valid: false, errors };
  }
  if (config !== null && config !== undefined && (typeof config !== 'object' || Array.isArray(config))) {
    errors.push({ code: 'INVALID_CONFIG_OBJECT', path: 'config', message: 'Node config must be a plain object' });
    return { valid: false, errors };
  }
  scanConfigValue(config || {}, 'config', errors);

  const required = defItem.configSchema?.required || [];
  for (const field of required) {
    if (config?.[field] === undefined || config?.[field] === null || config?.[field] === '') {
      errors.push({ code: 'MISSING_REQUIRED_FIELD', path: `config.${field}`, message: `Missing required field "${field}"` });
    }
  }
  return { valid: errors.length === 0, errors, definition: defItem };
}
