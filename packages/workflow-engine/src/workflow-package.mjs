const FORMAT = 'operza.workflow';
const VERSION = 1;
const MAX_BYTES = 1_000_000;
const MAX_NODES = 200;
const MAX_DEPTH = 8;
const ACTION_KINDS = new Set(['sms', 'email', 'wait', 'tag', 'task', 'webhook', 'condition']);
const TRIGGER_KINDS = new Set(['form', 'tag', 'appointment', 'invoice', 'payment', 'webhook', 'schedule']);
const CONFIG_KEYS = new Set(['method', 'url', 'tag', 'title', 'dueInDays', 'rule']);
const SECRET_KEY = /(password|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|client[_-]?secret)/i;
const RULE_FIELDS = new Set(['tag', 'status', 'company', 'email']);
const RULE_OPERATORS = new Set(['is', 'is_not', 'contains']);

function fail(message, code) {
  throw Object.assign(new TypeError(message), { code });
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Object.getOwnPropertySymbols(value).length === 0;
}

function checkSecretKeys(value, path = 'workflow', depth = 0, seen = new WeakSet()) {
  if (depth > MAX_DEPTH) fail(path + ' exceeds the maximum nesting depth', 'PACKAGE_TOO_DEEP');
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) fail(path + ' contains a circular reference', 'PACKAGE_INVALID');
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkSecretKeys(item, path + '[' + index + ']', depth + 1, seen));
  } else if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        fail(path + ' contains an unsafe property', 'PACKAGE_INVALID');
      }
      if (SECRET_KEY.test(key)) fail(path + '.' + key + ' contains credential-like material', 'CREDENTIAL_FIELD');
      checkSecretKeys(child, path + '.' + key, depth + 1, seen);
    }
  } else {
    fail(path + ' must contain plain JSON data', 'PACKAGE_INVALID');
  }
  seen.delete(value);
}

function assertText(value, label, max = 240) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    fail(label + ' must be a non-empty string of at most ' + max + ' characters', 'PACKAGE_INVALID');
  }
  return value;
}

function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) fail('Webhook URL is invalid', 'INVALID_URL');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('Webhook URL must be an absolute HTTP or HTTPS URL', 'INVALID_URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) fail('Only HTTP and HTTPS URLs are allowed', 'INVALID_URL');
  if (parsed.username || parsed.password) fail('Webhook URL must not embed credentials', 'URL_CREDENTIALS');
  for (const key of parsed.searchParams.keys()) {
    if (/(token|key|secret|auth|password|signature)/i.test(key)) {
      fail('Webhook URL must not contain credential-like query parameters', 'URL_CREDENTIALS');
    }
  }
  return value;
}

function sanitizeRule(rule, path) {
  if (!isPlainObject(rule)) fail(path + ' must be an object', 'INVALID_RULE');
  if (!RULE_FIELDS.has(rule.field) || !RULE_OPERATORS.has(rule.operator)) {
    fail(path + ' uses an unsupported condition', 'INVALID_RULE');
  }
  return {
    field: rule.field,
    operator: rule.operator,
    value: assertText(rule.value, path + '.value', 500)
  };
}

function sanitizeConfig(config, path) {
  if (config === undefined || config === null) return {};
  if (!isPlainObject(config)) fail(path + ' must be a JSON object', 'INVALID_CONFIG');
  const keys = Object.keys(config);
  for (const key of keys) {
    if (!CONFIG_KEYS.has(key)) fail(path + '.' + key + ' is not a supported configuration field', 'INVALID_CONFIG');
  }
  const result = {};
  if (config.method !== undefined) {
    if (!['GET', 'POST', 'PUT'].includes(config.method)) fail(path + '.method is unsupported', 'INVALID_CONFIG');
    result.method = config.method;
  }
  if (config.url !== undefined) result.url = safeUrl(config.url);
  if (config.tag !== undefined) result.tag = assertText(config.tag, path + '.tag', 120);
  if (config.title !== undefined) result.title = assertText(config.title, path + '.title', 240);
  if (config.dueInDays !== undefined) {
    if (!Number.isInteger(config.dueInDays) || config.dueInDays < 0 || config.dueInDays > 3650) {
      fail(path + '.dueInDays is outside the supported range', 'INVALID_CONFIG');
    }
    result.dueInDays = config.dueInDays;
  }
  if (config.rule !== undefined) result.rule = sanitizeRule(config.rule, path + '.rule');
  return result;
}

function sanitizeTrigger(trigger) {
  if (!isPlainObject(trigger) || !TRIGGER_KINDS.has(trigger.kind)) {
    fail('Workflow trigger is missing or unsupported', 'INVALID_TRIGGER');
  }
  const result = { kind: trigger.kind };
  if (trigger.detail !== undefined) result.detail = assertText(trigger.detail, 'trigger.detail', 240);
  if (trigger.every !== undefined) {
    if (!Number.isInteger(trigger.every) || trigger.every < 1 || trigger.every > 10080) {
      fail('trigger.every must be an integer between 1 and 10080', 'INVALID_TRIGGER');
    }
    result.every = trigger.every;
  }
  if (trigger.unit !== undefined) {
    if (!['minutes', 'hours', 'days'].includes(trigger.unit)) fail('trigger.unit is unsupported', 'INVALID_TRIGGER');
    result.unit = trigger.unit;
  }
  if (trigger.kind === 'schedule' && (!result.every || !result.unit)) {
    fail('Schedule triggers require an interval and unit', 'INVALID_TRIGGER');
  }
  return result;
}

function sanitizeActions(actions, state, path = 'workflow.actions', depth = 0) {
  if (!Array.isArray(actions)) fail(path + ' must be an array', 'INVALID_ACTIONS');
  if (depth > MAX_DEPTH) fail(path + ' exceeds the branch depth limit', 'PACKAGE_TOO_DEEP');
  return actions.map((action, index) => {
    const actionPath = path + '[' + index + ']';
    state.nodes += 1;
    if (state.nodes > MAX_NODES) fail('Workflow exceeds ' + MAX_NODES + ' nodes', 'TOO_MANY_NODES');
    if (!isPlainObject(action)) fail(actionPath + ' must be an object', 'INVALID_ACTION');
    if (!ACTION_KINDS.has(action.kind)) fail(actionPath + ' has an unsupported node type', 'UNSUPPORTED_NODE');
    const id = assertText(action.id, actionPath + '.id', 180);
    if (state.ids.has(id)) fail('Workflow node IDs must be unique', 'DUPLICATE_NODE_ID');
    state.ids.add(id);
    const result = {
      id,
      kind: action.kind,
      label: assertText(action.label, actionPath + '.label', 240),
      config: sanitizeConfig(action.config, actionPath + '.config')
    };
    if (action.delayHours !== undefined) {
      if (!Number.isFinite(action.delayHours) || action.delayHours < 0 || action.delayHours > 8760) {
        fail(actionPath + '.delayHours is outside the supported range', 'INVALID_ACTION');
      }
      result.delayHours = action.delayHours;
    }
    const hasYes = action.yes !== undefined;
    const hasNo = action.no !== undefined;
    if ((hasYes || hasNo) && action.kind !== 'condition') {
      fail(actionPath + ' branches are only supported on condition nodes', 'INVALID_BRANCH');
    }
    if (hasYes) result.yes = sanitizeActions(action.yes, state, actionPath + '.yes', depth + 1);
    if (hasNo) result.no = sanitizeActions(action.no, state, actionPath + '.no', depth + 1);
    return result;
  });
}

function sanitizeWorkflow(workflow) {
  if (!isPlainObject(workflow)) fail('Workflow must be an object', 'INVALID_WORKFLOW');
  const status = workflow.status ?? 'draft';
  if (!['draft', 'published'].includes(status)) fail('Workflow status is unsupported', 'INVALID_WORKFLOW');
  const state = { nodes: 0, ids: new Set() };
  const actions = sanitizeActions(workflow.actions ?? [], state);
  const enrolled = workflow.enrolled ?? 0;
  const completed = workflow.completed ?? 0;
  if (!Number.isInteger(enrolled) || enrolled < 0 || !Number.isInteger(completed) || completed < 0) {
    fail('Workflow counters must be non-negative integers', 'INVALID_WORKFLOW');
  }
  return {
    id: assertText(workflow.id, 'workflow.id', 180),
    name: assertText(workflow.name, 'workflow.name', 240),
    status,
    trigger: sanitizeTrigger(workflow.trigger),
    actions,
    enrolled,
    completed
  };
}

function checkPackageSize(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail('Workflow package cannot be serialized as JSON', 'PACKAGE_INVALID');
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES) {
    fail('Workflow package exceeds the 1 MB size limit', 'PACKAGE_TOO_LARGE');
  }
}

export function exportWorkflowPackage(workflow, { now = Date.now() } = {}) {
  checkSecretKeys(workflow);
  const safeWorkflow = sanitizeWorkflow(workflow);
  const exportedAt = new Date(now).toISOString();
  const result = { format: FORMAT, version: VERSION, exportedAt, workflow: safeWorkflow };
  checkPackageSize(result);
  return result;
}

function rekeyActions(actions, idFactory, usedIds) {
  return actions.map((action) => {
    const id = idFactory('wa');
    if (typeof id !== 'string' || !id.trim() || usedIds.has(id)) {
      fail('ID factory must return unique, non-empty IDs', 'INVALID_ID_FACTORY');
    }
    usedIds.add(id);
    const result = { ...action, id };
    if (action.yes) result.yes = rekeyActions(action.yes, idFactory, usedIds);
    if (action.no) result.no = rekeyActions(action.no, idFactory, usedIds);
    return result;
  });
}

export function importWorkflowPackage(input, {
  idFactory = (prefix) => prefix + '_' + Math.random().toString(36).slice(2, 10)
} = {}) {
  checkPackageSize(input);
  checkSecretKeys(input);
  if (!isPlainObject(input) || input.format !== FORMAT || input.version !== VERSION) {
    fail('File is not a supported Operza workflow package', 'PACKAGE_FORMAT');
  }
  const safeWorkflow = sanitizeWorkflow(input.workflow);
  const newWorkflowId = idFactory('wf');
  if (typeof newWorkflowId !== 'string' || !newWorkflowId.trim()) {
    fail('ID factory must return a non-empty workflow ID', 'INVALID_ID_FACTORY');
  }
  const usedIds = new Set([newWorkflowId]);
  return {
    ...safeWorkflow,
    id: newWorkflowId,
    status: 'draft',
    enrolled: 0,
    completed: 0,
    actions: rekeyActions(safeWorkflow.actions, idFactory, usedIds)
  };
}
