/**
 * Product Advancement Stage 1 — CRM 2.0 Core Logic
 * Provides email/phone normalization, duplicate candidate detection,
 * safe AND/OR Smart List AST validation & evaluation (zero arbitrary SQL),
 * and strict custom-field type validation.
 */

const ALLOWED_FILTER_FIELDS = new Set([
  'status',
  'lifecycleStage',
  'tags',
  'ownerId',
  'source',
  'createdAt',
  'lastActivityAt',
  'opportunityStage',
  'customerValueCents',
  'hasUnpaidInvoice',
  'consentStatus'
]);

const ALLOWED_OPS = new Set(['eq', 'neq', 'contains', 'in', 'gt', 'gte', 'lt', 'lte', 'exists']);

export function normalizeEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return '';
  return clean;
}

export function normalizePhone(phone, defaultCountryCode = '+1') {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  const onlyDigits = digits.replace(/\D/g, '');
  if (onlyDigits.length === 10 && defaultCountryCode === '+1') return `+1${onlyDigits}`;
  return `+${onlyDigits}`;
}

export function detectDuplicateCandidates(contacts = []) {
  const emailMap = new Map();
  const phoneMap = new Map();
  const nameCompanyMap = new Map();
  const groups = [];

  for (const c of contacts) {
    const email = normalizeEmail(c.email);
    if (email) {
      if (!emailMap.has(email)) emailMap.set(email, []);
      emailMap.get(email).push(c);
    }
    const phone = normalizePhone(c.phone);
    if (phone && phone.length >= 8) {
      if (!phoneMap.has(phone)) phoneMap.set(phone, []);
      phoneMap.get(phone).push(c);
    }
    const nameKey = `${String(c.firstName || '').trim().toLowerCase()} ${String(c.lastName || '').trim().toLowerCase()}`.trim();
    const companyKey = String(c.company || '').trim().toLowerCase();
    if (nameKey && companyKey) {
      const ncKey = `${nameKey}::${companyKey}`;
      if (!nameCompanyMap.has(ncKey)) nameCompanyMap.set(ncKey, []);
      nameCompanyMap.get(ncKey).push(c);
    }
  }

  for (const [key, list] of emailMap.entries()) {
    if (list.length > 1) groups.push({ confidence: 'high', reason: 'exact_email', matchKey: key, contacts: list });
  }
  for (const [key, list] of phoneMap.entries()) {
    if (list.length > 1) groups.push({ confidence: 'high', reason: 'exact_phone', matchKey: key, contacts: list });
  }
  for (const [key, list] of nameCompanyMap.entries()) {
    if (list.length > 1) groups.push({ confidence: 'warning', reason: 'name_company_similarity', matchKey: key, contacts: list });
  }
  return groups;
}

export function validateSmartListAst(node, depth = 0, counter = { count: 0 }) {
  if (depth > 4) {
    throw Object.assign(new RangeError('Smart List filter nesting depth exceeds maximum (4)'), { code: 'FILTER_DEPTH_EXCEEDED' });
  }
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw Object.assign(new TypeError('Smart List filter node must be an object'), { code: 'INVALID_FILTER_AST' });
  }
  if (node.op === 'and' || node.op === 'or') {
    if (!Array.isArray(node.rules)) {
      throw Object.assign(new TypeError('Group node must contain rules array'), { code: 'INVALID_FILTER_AST' });
    }
    for (const child of node.rules) {
      validateSmartListAst(child, depth + 1, counter);
    }
    return true;
  }

  counter.count += 1;
  if (counter.count > 50) {
    throw Object.assign(new RangeError('Smart List rule count exceeds maximum (50)'), { code: 'FILTER_LIMIT_EXCEEDED' });
  }

  const field = String(node.field || '');
  const isCustom = field.startsWith('customFields.') && /^customFields\.[a-z][a-z0-9_]{1,63}$/.test(field);
  if (!ALLOWED_FILTER_FIELDS.has(field) && !isCustom) {
    throw Object.assign(new TypeError(`Unsupported Smart List field: ${field}`), { code: 'UNSUPPORTED_FILTER_FIELD' });
  }
  if (!ALLOWED_OPS.has(node.operator)) {
    throw Object.assign(new TypeError(`Unsupported Smart List operator: ${node.operator}`), { code: 'UNSUPPORTED_FILTER_OPERATOR' });
  }
  return true;
}

function getFieldValue(record, field) {
  if (field.startsWith('customFields.')) {
    const key = field.slice('customFields.'.length);
    return record?.customFields?.[key];
  }
  return record?.[field];
}

export function evaluateSmartListAst(node, record) {
  if (node.op === 'and') {
    return (node.rules || []).every((r) => evaluateSmartListAst(r, record));
  }
  if (node.op === 'or') {
    return (node.rules || []).some((r) => evaluateSmartListAst(r, record));
  }

  const actual = getFieldValue(record, node.field);
  const expected = node.value;
  switch (node.operator) {
    case 'exists':
      return actual !== undefined && actual !== null && actual !== '';
    case 'eq':
      return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
    case 'neq':
      return Array.isArray(actual) ? !actual.includes(expected) : actual !== expected;
    case 'contains':
      return Array.isArray(actual)
        ? actual.some((item) => String(item).toLowerCase().includes(String(expected || '').toLowerCase()))
        : String(actual || '').toLowerCase().includes(String(expected || '').toLowerCase());
    case 'in':
      return Array.isArray(expected) && (Array.isArray(actual) ? actual.some((a) => expected.includes(a)) : expected.includes(actual));
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    default:
      return false;
  }
}

export function validateCustomFieldValue(def, value) {
  if (value === undefined || value === null || value === '') {
    if (def.required) {
      return { valid: false, code: 'CUSTOM_FIELD_REQUIRED', message: `Custom field '${def.fieldKey}' is required` };
    }
    return { valid: true };
  }

  switch (def.fieldType) {
    case 'text':
      return typeof value === 'string' ? { valid: true } : { valid: false, code: 'INVALID_FIELD_TYPE' };
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? { valid: true } : { valid: false, code: 'INVALID_FIELD_TYPE' };
    case 'boolean':
      return typeof value === 'boolean' ? { valid: true } : { valid: false, code: 'INVALID_FIELD_TYPE' };
    case 'date':
      return !Number.isNaN(Date.parse(String(value))) ? { valid: true } : { valid: false, code: 'INVALID_FIELD_TYPE' };
    case 'select':
      return Array.isArray(def.options) && def.options.includes(value) ? { valid: true } : { valid: false, code: 'INVALID_SELECT_OPTION' };
    case 'multi_select':
      return Array.isArray(value) && value.every((v) => (def.options || []).includes(v))
        ? { valid: true }
        : { valid: false, code: 'INVALID_SELECT_OPTION' };
    case 'url':
      try {
        const u = new URL(String(value));
        return ['http:', 'https:'].includes(u.protocol) ? { valid: true } : { valid: false, code: 'INVALID_URL_PROTOCOL' };
      } catch {
        return { valid: false, code: 'INVALID_URL' };
      }
    default:
      return { valid: false, code: 'UNSUPPORTED_CUSTOM_FIELD_TYPE' };
  }
}
