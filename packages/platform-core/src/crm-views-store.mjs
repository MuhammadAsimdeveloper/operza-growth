import crypto from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED_OPS = new Set([
  'equals', 'not_equals', 'contains', 'starts_with', 'ends_with',
  'gt', 'gte', 'lt', 'lte', 'exists', 'in', 'not_in', 'between'
]);
const ALLOWED_FIELDS = new Set([
  'firstName', 'lastName', 'email', 'phone', 'company', 'tags',
  'leadScore', 'status', 'assignedTo', 'createdAt', 'updatedAt'
]);

function fail(code, message) {
  throw Object.assign(new TypeError(message), { code });
}

function stable(value) {
  return JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
}

function hash(value) {
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}

export function validateCondition(condition) {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    fail('INVALID_CONDITION', 'Filter condition must be an object');
  }

  const { field, op, value } = condition;
  if (!ALLOWED_FIELDS.has(field)) {
    fail('INVALID_FILTER_FIELD', `Field "${field}" is not a recognized or queryable CRM field`);
  }
  if (!SUPPORTED_OPS.has(op)) {
    fail('INVALID_OPERATOR', `Operator "${op}" is not supported`);
  }

  if (op !== 'exists') {
    if (value === undefined || value === null) {
      fail('MISSING_VALUE', `Filter value is required for operator "${op}"`);
    }
  }

  if (['in', 'not_in'].includes(op) && (!Array.isArray(value) || value.length > 100)) {
    fail('INVALID_VALUE_ARRAY', 'in/not_in operator requires an array of up to 100 items');
  }

  if (op === 'between' && (!Array.isArray(value) || value.length !== 2)) {
    fail('INVALID_BETWEEN_RANGE', 'between operator requires an array of exactly 2 values [min, max]');
  }

  return Object.freeze({ field, op, value });
}

export function createSmartListView({
  id = crypto.randomUUID(),
  agencyId,
  locationId,
  name,
  objectType = 'contacts',
  logic = 'and',
  conditions = [],
  createdBy
} = {}) {
  if (!agencyId) fail('MISSING_AGENCY_ID', 'agencyId is required');
  if (!locationId) fail('MISSING_LOCATION_ID', 'locationId is required');
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) {
    fail('INVALID_VIEW_NAME', 'Smart List name must be between 2 and 120 characters');
  }
  if (!['and', 'or'].includes(logic)) {
    fail('INVALID_LOGIC', 'Logic must be "and" or "or"');
  }
  if (!Array.isArray(conditions) || conditions.length > 50) {
    fail('TOO_MANY_CONDITIONS', 'A Smart List can contain at most 50 conditions');
  }

  const normalizedConditions = conditions.map(validateCondition);

  const viewData = {
    id,
    agencyId,
    locationId,
    name: name.trim(),
    objectType,
    logic,
    conditions: normalizedConditions,
    createdBy: createdBy || 'system',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  return Object.freeze({
    ...viewData,
    viewHash: hash(viewData)
  });
}

function compareValues(actual, op, expected) {
  if (op === 'exists') {
    return expected === false ? (actual === undefined || actual === null || actual === '') : (actual !== undefined && actual !== null && actual !== '');
  }

  if (actual === undefined || actual === null) return false;

  if (op === 'equals') {
    return String(actual).toLowerCase() === String(expected).toLowerCase();
  }
  if (op === 'not_equals') {
    return String(actual).toLowerCase() !== String(expected).toLowerCase();
  }
  if (op === 'contains') {
    if (Array.isArray(actual)) {
      return actual.some(item => String(item).toLowerCase().includes(String(expected).toLowerCase()));
    }
    return String(actual).toLowerCase().includes(String(expected).toLowerCase());
  }
  if (op === 'starts_with') {
    return String(actual).toLowerCase().startsWith(String(expected).toLowerCase());
  }
  if (op === 'ends_with') {
    return String(actual).toLowerCase().endsWith(String(expected).toLowerCase());
  }
  if (op === 'gt') return Number(actual) > Number(expected);
  if (op === 'gte') return Number(actual) >= Number(expected);
  if (op === 'lt') return Number(actual) < Number(expected);
  if (op === 'lte') return Number(actual) <= Number(expected);
  if (op === 'in') {
    return Array.isArray(expected) && expected.some(v => String(v).toLowerCase() === String(actual).toLowerCase());
  }
  if (op === 'not_in') {
    return Array.isArray(expected) && !expected.some(v => String(v).toLowerCase() === String(actual).toLowerCase());
  }
  if (op === 'between') {
    const num = Number(actual);
    return num >= Number(expected[0]) && num <= Number(expected[1]);
  }

  return false;
}

export function matchesSmartListView({ view, record, agencyId, locationId }) {
  if (!view || !record) fail('MISSING_ARGUMENTS', 'View and record are required');
  if (view.agencyId !== agencyId || view.locationId !== locationId) {
    return false; // Cross-tenant boundary
  }

  if (record.agencyId && record.agencyId !== agencyId) return false;
  if (record.locationId && record.locationId !== locationId) return false;

  if (!view.conditions || view.conditions.length === 0) return true;

  const results = view.conditions.map(cond => {
    return compareValues(record[cond.field], cond.op, cond.value);
  });

  return view.logic === 'or' ? results.some(Boolean) : results.every(Boolean);
}

export function filterSmartListRecords({
  view,
  records = [],
  agencyId,
  locationId,
  limit = 50,
  offset = 0
}) {
  if (!Array.isArray(records)) fail('INVALID_RECORDS', 'Records must be an array');
  const matched = records.filter(rec => matchesSmartListView({ view, record: rec, agencyId, locationId }));
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const boundedOffset = Math.max(0, Math.floor(offset));

  return Object.freeze({
    total: matched.length,
    items: matched.slice(boundedOffset, boundedOffset + boundedLimit),
    limit: boundedLimit,
    offset: boundedOffset
  });
}

/**
 * Builds a parameterized PostgreSQL SQL WHERE clause from a Smart List definition.
 * Strictly prevents SQL injection using parameterized values ($1, $2, ...).
 */
export function generateSmartListSql({
  view,
  tableName = 'contacts',
  agencyId,
  locationId,
  startIndex = 1
}) {
  if (!view || !agencyId || !locationId) fail('MISSING_ARGUMENTS', 'view, agencyId, and locationId required');

  const params = [agencyId, locationId];
  let paramIdx = startIndex + 2;

  const clauses = [];

  for (const cond of view.conditions || []) {
    const colName = cond.field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`); // camelCase to snake_case
    const qualifiedCol = `${tableName}.${colName}`;

    if (cond.op === 'exists') {
      if (cond.value === false) {
        clauses.push(`(${qualifiedCol} IS NULL OR ${qualifiedCol} = '')`);
      } else {
        clauses.push(`(${qualifiedCol} IS NOT NULL AND ${qualifiedCol} != '')`);
      }
    } else if (cond.op === 'equals') {
      clauses.push(`LOWER(${qualifiedCol}::text) = LOWER($${paramIdx})`);
      params.push(String(cond.value));
      paramIdx++;
    } else if (cond.op === 'not_equals') {
      clauses.push(`LOWER(${qualifiedCol}::text) != LOWER($${paramIdx})`);
      params.push(String(cond.value));
      paramIdx++;
    } else if (cond.op === 'contains') {
      clauses.push(`${qualifiedCol}::text ILIKE '%' || $${paramIdx} || '%'`);
      params.push(String(cond.value));
      paramIdx++;
    } else if (cond.op === 'starts_with') {
      clauses.push(`${qualifiedCol}::text ILIKE $${paramIdx} || '%'`);
      params.push(String(cond.value));
      paramIdx++;
    } else if (cond.op === 'ends_with') {
      clauses.push(`${qualifiedCol}::text ILIKE '%' || $${paramIdx}`);
      params.push(String(cond.value));
      paramIdx++;
    } else if (['gt', 'gte', 'lt', 'lte'].includes(cond.op)) {
      const sqlOp = cond.op === 'gt' ? '>' : cond.op === 'gte' ? '>=' : cond.op === 'lt' ? '<' : '<=';
      clauses.push(`${qualifiedCol} ${sqlOp} $${paramIdx}::numeric`);
      params.push(Number(cond.value));
      paramIdx++;
    } else if (cond.op === 'in') {
      clauses.push(`${qualifiedCol}::text = ANY($${paramIdx}::text[])`);
      params.push(cond.value.map(String));
      paramIdx++;
    } else if (cond.op === 'not_in') {
      clauses.push(`NOT (${qualifiedCol}::text = ANY($${paramIdx}::text[]))`);
      params.push(cond.value.map(String));
      paramIdx++;
    } else if (cond.op === 'between') {
      clauses.push(`${qualifiedCol} BETWEEN $${paramIdx} AND $${paramIdx + 1}`);
      params.push(cond.value[0], cond.value[1]);
      paramIdx += 2;
    }
  }

  const joiner = view.logic === 'or' ? ' OR ' : ' AND ';
  const conditionSql = clauses.length > 0 ? `AND (${clauses.join(joiner)})` : '';

  const fullSql = `SELECT * FROM ${tableName} WHERE ${tableName}.agency_id = $1 AND ${tableName}.location_id = $2 ${conditionSql} ORDER BY ${tableName}.created_at DESC`;

  return {
    sql: fullSql,
    params
  };
}
