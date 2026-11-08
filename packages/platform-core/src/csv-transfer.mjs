import crypto from 'node:crypto';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_MAX_ROWS = 25000;
const DEFAULT_MAX_COLUMNS = 200;
const FORMULA_PREFIX = /^[\s\u0000-\u001f\uFEFF]*[=+\-@]/;

function boundedInt(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} out of bounds: must be between ${min} and ${max}`);
  }
  return value;
}

function canonical(value) {
  return JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]]))
    : item);
}

function hash(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function cellText(value, label = 'cell') {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  throw new TypeError(`${label} must be a scalar (string, number, or boolean)`);
}

export function parseCsvRows(text, { maxRows = DEFAULT_MAX_ROWS, maxColumns = DEFAULT_MAX_COLUMNS } = {}) {
  const rows = [];
  let row = [], cell = '', quoted = false, closedQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"' && cell === '' && !closedQuote) {
      quoted = true;
      continue;
    }
    // If quote appears in the middle of unquoted text, keep it as literal character
    if (ch === '"') {
      cell += '"';
      continue;
    }

    if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(cell);
      cell = '';
      closedQuote = false;

      if (row.length > maxColumns) throw new RangeError(`CSV column limit (${maxColumns}) exceeded`);
      if (ch === ',') continue;

      if (ch === '\r' && text[i + 1] === '\n') i++;

      if (rows.length >= maxRows + 1) throw new RangeError(`CSV row limit (${maxRows}) exceeded`);
      rows.push(row);
      row = [];
      continue;
    }

    if (closedQuote) throw new SyntaxError('Unexpected character after quoted CSV cell');
    cell += ch;
  }

  if (quoted) throw new SyntaxError('Unterminated quoted CSV cell');

  if (cell.length || row.length) {
    row.push(cell);
    if (row.length > maxColumns) throw new RangeError(`CSV column limit (${maxColumns}) exceeded`);
    if (rows.length >= maxRows + 1) throw new RangeError(`CSV row limit (${maxRows}) exceeded`);
    rows.push(row);
  }

  return rows;
}

/**
 * Parses and validates CSV import for Operza CRM contacts.
 * Defends against formula injection, detects duplicates (email, phone), and maps fields.
 */
export function parseAndValidateCsvImport({
  text,
  agencyId,
  locationId,
  existingContacts = [],
  schemaProperties = null,
  maxBytes = DEFAULT_MAX_BYTES,
  maxRows = DEFAULT_MAX_ROWS,
  maxColumns = DEFAULT_MAX_COLUMNS
} = {}) {
  if (typeof text !== 'string') throw new TypeError('CSV text required');
  if (!agencyId) throw new TypeError('agencyId is required');
  if (!locationId) throw new TypeError('locationId is required');

  boundedInt(maxBytes, 'maxBytes', 1, 50 * 1024 * 1024);
  boundedInt(maxRows, 'maxRows', 1, 100_000);
  boundedInt(maxColumns, 'maxColumns', 1, DEFAULT_MAX_COLUMNS);

  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new RangeError(`CSV byte limit (${maxBytes} bytes) exceeded`);
  }

  const cleanText = text.replace(/^\uFEFF/, '');
  const parsed = parseCsvRows(cleanText, { maxRows, maxColumns });
  if (!parsed.length) throw new TypeError('CSV header row is required');

  const rawHeaders = parsed.shift().map(h => h.trim());
  if (!rawHeaders.length || rawHeaders.some(h => !h) || new Set(rawHeaders).size !== rawHeaders.length) {
    throw new TypeError('CSV headers must be non-empty and unique');
  }

  // Normalize header names (lowercase, remove spaces and underscores)
  const headerMap = new Map();
  for (const h of rawHeaders) {
    const norm = h.toLowerCase().replace(/[\s_-]+/g, '');
    headerMap.set(norm, h);
  }

  // Map known fields
  const fieldMapping = {
    firstname: 'firstName',
    first: 'firstName',
    lastname: 'lastName',
    last: 'lastName',
    name: 'firstName', // fallback
    email: 'email',
    phone: 'phone',
    telephone: 'phone',
    mobile: 'phone',
    company: 'company',
    organization: 'company',
    title: 'title',
    jobtitle: 'title',
    tags: 'tags',
    leadscore: 'leadScore',
    score: 'leadScore'
  };

  const existingEmails = new Set(
    existingContacts.map(c => (c.email || '').toLowerCase().trim()).filter(Boolean)
  );
  const existingPhones = new Set(
    existingContacts.map(c => (c.phone || '').replace(/[^0-9+]/g, '')).filter(Boolean)
  );

  const seenInBatchEmails = new Set();
  const seenInBatchPhones = new Set();

  const rows = [];
  const validRecords = [];
  const duplicates = [];

  for (let idx = 0; idx < parsed.length; idx++) {
    const cells = parsed[idx];
    const rowNum = idx + 2;

    if (cells.length !== rawHeaders.length) {
      rows.push({
        row: rowNum,
        record: null,
        valid: false,
        errors: [{ field: null, message: `Expected ${rawHeaders.length} columns, found ${cells.length}` }]
      });
      continue;
    }

    const rawRecord = {};
    for (let i = 0; i < rawHeaders.length; i++) {
      let val = cells[i].trim();
      // Neutralize formula injection, while safely preserving international phone numbers starting with +
      const isPhoneNumber = /^\+[0-9\s().-]{7,25}$/.test(val);
      if (FORMULA_PREFIX.test(val) && !isPhoneNumber) {
        val = val.replace(/^[\s\u0000-\u001f\uFEFF]*[=+\-@]+/, '');
      }
      rawRecord[rawHeaders[i]] = val;
    }

    // Map to canonical Operza Contact structure
    const mapped = {
      agencyId,
      locationId,
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      company: '',
      tags: [],
      leadScore: 0
    };

    for (const [normHeader, rawHeader] of headerMap.entries()) {
      const canonicalProp = fieldMapping[normHeader];
      if (canonicalProp) {
        let val = rawRecord[rawHeader];
        if (canonicalProp === 'tags') {
          mapped.tags = val ? val.split(/[;,|]/).map(t => t.trim()).filter(Boolean) : [];
        } else if (canonicalProp === 'leadScore') {
          mapped.leadScore = Number.isFinite(Number(val)) ? Number(val) : 0;
        } else {
          mapped[canonicalProp] = val;
        }
      }
    }

    // Basic Contact Validation
    const errors = [];
    if (!mapped.firstName && !mapped.lastName && !mapped.email && !mapped.phone) {
      errors.push({ field: 'contact', message: 'Row must provide at least a name, email, or phone' });
    }

    const normEmail = (mapped.email || '').toLowerCase().trim();
    const normPhone = (mapped.phone || '').replace(/[^0-9+]/g, '');

    let isDuplicate = false;
    let dupReason = '';

    if (normEmail) {
      if (seenInBatchEmails.has(normEmail)) {
        isDuplicate = true;
        dupReason = `Duplicate email "${normEmail}" within CSV batch`;
      } else if (existingEmails.has(normEmail)) {
        isDuplicate = true;
        dupReason = `Duplicate email "${normEmail}" already exists in CRM`;
      }
    }

    if (normPhone && !isDuplicate) {
      if (seenInBatchPhones.has(normPhone)) {
        isDuplicate = true;
        dupReason = `Duplicate phone "${normPhone}" within CSV batch`;
      } else if (existingPhones.has(normPhone)) {
        isDuplicate = true;
        dupReason = `Duplicate phone "${normPhone}" already exists in CRM`;
      }
    }

    if (isDuplicate) {
      duplicates.push({ row: rowNum, reason: dupReason, record: mapped });
    } else {
      if (normEmail) seenInBatchEmails.add(normEmail);
      if (normPhone) seenInBatchPhones.add(normPhone);
    }

    const valid = errors.length === 0 && !isDuplicate;
    if (valid) {
      validRecords.push(mapped);
    }

    rows.push({
      row: rowNum,
      record: mapped,
      valid,
      isDuplicate,
      dupReason: dupReason || null,
      errors
    });
  }

  const validRows = rows.filter(r => r.valid).length;

  return Object.freeze({
    agencyId,
    locationId,
    rowCount: rows.length,
    validRows,
    invalidRows: rows.length - validRows,
    duplicateCount: duplicates.length,
    validRecords,
    duplicates,
    rows,
    planHash: hash({ agencyId, locationId, headers: rawHeaders, rowCount: rows.length })
  });
}

/**
 * Formats data rows into a formula-safe CSV string.
 */
export function exportContactsToCsv({
  contacts = [],
  fields = ['firstName', 'lastName', 'email', 'phone', 'company', 'tags', 'leadScore'],
  maxRows = DEFAULT_MAX_ROWS
} = {}) {
  if (!Array.isArray(contacts)) throw new TypeError('contacts must be an array');
  boundedInt(maxRows, 'maxRows', 1, 100_000);
  if (contacts.length > maxRows) throw new RangeError(`Export exceeds maximum limit of ${maxRows} rows`);

  function formatCell(val) {
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) val = val.join(';');
    let str = String(val);

    // Defend against CSV injection in spreadsheets
    if (FORMULA_PREFIX.test(str)) {
      str = "'" + str;
    }

    if (/[",;\r\n]/.test(str)) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  const headerLine = fields.map(formatCell).join(',');
  const lines = [headerLine];

  for (const contact of contacts) {
    const row = fields.map(field => formatCell(contact[field]));
    lines.push(row.join(','));
  }

  return lines.join('\r\n') + '\r\n';
}
