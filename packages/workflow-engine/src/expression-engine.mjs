/**
 * ============================================================================
 * Operza Workflow Engine: Sandboxed Recursive Descent AST Expression Engine
 * ============================================================================
 * Ported from Atlas Core. Evaluates expressions deterministically with bounded
 * recursion and zero arbitrary code execution (no eval, no Function constructor).
 */

const ROOT = /^(input|trigger|steps|contact|lead|deal|appointment|conversation|workflow)$/;
const PATH_SEGMENT = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const RESERVED = new Set(['tenantId', 'actorId', 'credential', 'secret', 'token', 'authorization', 'password', 'cookie', 'privateKey']);
const FUNCTIONS = new Set(['string', 'number', 'boolean', 'trim', 'lowercase', 'uppercase', 'join', 'coalesce', 'exists', 'length']);
const MAX_EXPRESSION_LENGTH = 4000;
const MAX_NODES = 100;
const MAX_STRING_LENGTH = 10000;
const MAX_ARRAY_LENGTH = 100;

function error(code, message, path = null) {
  const e = new TypeError(message);
  e.code = code;
  if (path) e.path = path;
  throw e;
}

function boundedString(value, label, max) {
  if (typeof value !== 'string' || value.length > max || /[\u0000\r\n]/.test(value)) error('expression_invalid', label + ' is invalid');
  return value;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype && Object.getOwnPropertySymbols(v).length === 0;
}

function safeResult(v, depth = 0, seen = new WeakSet()) {
  if (depth > 8) error('expression_result_too_deep', 'Expression result is too deeply nested');
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (v.length > MAX_STRING_LENGTH) error('expression_result_too_large', 'Expression result string is too large');
    return v;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) error('expression_evaluation_failed', 'Expression result is not finite');
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length > MAX_ARRAY_LENGTH) error('expression_result_too_large', 'Expression result array is too large');
    if (seen.has(v)) error('expression_evaluation_failed', 'Expression result contains a cycle');
    seen.add(v);
    const out = v.map(x => safeResult(x, depth + 1, seen));
    seen.delete(v);
    return out;
  }
  if (isPlainObject(v)) {
    if (seen.has(v)) error('expression_evaluation_failed', 'Expression result contains a cycle');
    const keys = Object.keys(v);
    if (keys.length > 100) error('expression_result_too_large', 'Expression result object is too large');
    seen.add(v);
    const out = {};
    for (const key of keys) {
      if (RESERVED.has(key)) error('expression_evaluation_failed', 'Expression result exposes a reserved field');
      out[key] = safeResult(v[key], depth + 1, seen);
    }
    seen.delete(v);
    return out;
  }
  error('expression_evaluation_failed', 'Expression produced an unsupported value');
}

class Parser {
  constructor(source, context, syntaxOnly = false) {
    this.source = source;
    this.i = 0;
    this.context = context;
    this.syntaxOnly = syntaxOnly;
    this.nodes = 0;
  }
  bump() {
    if (++this.nodes > MAX_NODES) error('expression_too_complex', 'Expression exceeds the evaluation budget');
  }
  skip() {
    while (/\s/.test(this.source[this.i] || '')) this.i++;
  }
  peek(value) {
    return this.source.startsWith(value, this.i);
  }
  consume(value) {
    this.skip();
    if (this.source.startsWith(value, this.i)) {
      this.i += value.length;
      return true;
    }
    return false;
  }
  expect(value) {
    if (!this.consume(value)) error('expression_invalid', 'Expected ' + value + ' at offset ' + this.i);
  }
  parse() {
    this.skip();
    const value = this.parseOr();
    this.skip();
    if (this.i !== this.source.length) error('expression_invalid', 'Unexpected expression token at offset ' + this.i);
    return safeResult(value);
  }
  parseOr() {
    let left = this.parseAnd();
    for (;;) {
      if (!this.consume('||')) return left;
      const right = this.parseAnd();
      left = this.syntaxOnly ? null : (Boolean(left) || Boolean(right));
      this.bump();
    }
  }
  parseAnd() {
    let left = this.parseEquality();
    for (;;) {
      if (!this.consume('&&')) return left;
      const right = this.parseEquality();
      left = this.syntaxOnly ? null : (Boolean(left) && Boolean(right));
      this.bump();
    }
  }
  parseEquality() {
    let left = this.parseComparison();
    for (;;) {
      let op = null;
      for (const candidate of ['===', '!==', '==', '!=']) {
        if (this.consume(candidate)) { op = candidate; break; }
      }
      if (!op) return left;
      const right = this.parseComparison();
      left = this.syntaxOnly ? null : (op === '===' || op === '==' ? deepEqual(left, right) : !deepEqual(left, right));
      this.bump();
    }
  }
  parseComparison() {
    let left = this.parseAdditive();
    for (;;) {
      let op = null;
      for (const candidate of ['>=', '<=', '>', '<']) {
        if (this.consume(candidate)) { op = candidate; break; }
      }
      if (!op) return left;
      const right = this.parseAdditive();
      if (this.syntaxOnly) { left = null; this.bump(); continue; }
      if ((typeof left === 'number' && Number.isFinite(left)) && (typeof right === 'number' && Number.isFinite(right))) {
        if (op === '>') left = left > right;
        else if (op === '>=') left = left >= right;
        else if (op === '<') left = left < right;
        else left = left <= right;
      } else if (typeof left === 'string' && typeof right === 'string') {
        const cmp = left.localeCompare(right);
        if (op === '>') left = cmp > 0;
        else if (op === '>=') left = cmp >= 0;
        else if (op === '<') left = cmp < 0;
        else left = cmp <= 0;
      } else {
        error('expression_type_error', 'Comparison operands must both be numbers or strings');
      }
      this.bump();
    }
  }
  parseAdditive() {
    let left = this.parseMultiplicative();
    for (;;) {
      let op = null;
      if (this.consume('+')) op = '+';
      else if (this.consume('-')) op = '-';
      else return left;
      const right = this.parseMultiplicative();
      if (this.syntaxOnly) { left = null; this.bump(); continue; }
      if (op === '+' && typeof left === 'string') left = left + String(right);
      else if (op === '+' && typeof right === 'string') left = String(left) + right;
      else if (typeof left === 'number' && typeof right === 'number') left = op === '+' ? left + right : left - right;
      else error('expression_type_error', 'Arithmetic operands must be compatible');
      if (typeof left === 'number' && !Number.isFinite(left)) error('expression_evaluation_failed', 'Arithmetic result is not finite');
      if (typeof left === 'string' && left.length > MAX_STRING_LENGTH) error('expression_result_too_large', 'String concatenation is too large');
      this.bump();
    }
  }
  parseMultiplicative() {
    let left = this.parseUnary();
    for (;;) {
      let op = null;
      if (this.consume('*')) op = '*';
      else if (this.consume('/')) op = '/';
      else if (this.consume('%')) op = '%';
      else return left;
      const right = this.parseUnary();
      if (this.syntaxOnly) { left = null; this.bump(); continue; }
      if (typeof left !== 'number' || typeof right !== 'number' || !Number.isFinite(left) || !Number.isFinite(right)) {
        error('expression_type_error', 'Multiplication, division and modulo require finite numbers');
      }
      if ((op === '/' || op === '%') && right === 0) error('expression_evaluation_failed', 'Division by zero is not allowed');
      left = op === '*' ? left * right : op === '/' ? left / right : left % right;
      if (!Number.isFinite(left)) error('expression_evaluation_failed', 'Arithmetic result is not finite');
      this.bump();
    }
  }
  parseUnary() {
    if (this.consume('!')) {
      const value = this.parseUnary();
      this.bump();
      return this.syntaxOnly ? null : !value;
    }
    if (this.consume('-')) {
      const value = this.parseUnary();
      if (!this.syntaxOnly && (typeof value !== 'number' || !Number.isFinite(value))) {
        error('expression_type_error', 'Unary minus requires a finite number');
      }
      this.bump();
      return this.syntaxOnly ? null : -value;
    }
    return this.parsePrimary();
  }
  parsePrimary() {
    this.skip();
    if (this.consume('(')) {
      const v = this.parseOr();
      this.expect(')');
      this.bump();
      return v;
    }
    const ch = this.source[this.i];
    if (ch === '"' || ch === "'") return this.parseString();
    const number = this.source.slice(this.i).match(/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) {
      this.i += number[0].length;
      const v = Number(number[0]);
      if (!Number.isFinite(v)) error('expression_invalid', 'Numeric literal is not finite');
      this.bump();
      return v;
    }
    const ident = this.source.slice(this.i).match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (!ident) error('expression_invalid', 'Unexpected token at offset ' + this.i);
    const token = ident[0];
    this.i += token.length;
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (this.peek('(')) {
      if (!FUNCTIONS.has(token)) error('expression_invalid', 'Function is not allowlisted: ' + token);
      this.i++;
      const args = [];
      this.skip();
      if (this.consume(')')) return this.callFunction(token, args);
      for (let count = 0;; count++) {
        if (count >= 10) error('expression_too_complex', 'Function argument count is too large');
        args.push(this.parseOr());
        this.skip();
        if (this.consume(')')) break;
        this.expect(',');
      }
      return this.callFunction(token, args);
    }
    return this.readPath(token);
  }
  parseString() {
    const quote = this.source[this.i++];
    let out = '';
    for (;;) {
      if (this.i >= this.source.length) error('expression_invalid', 'Unterminated string literal');
      const ch = this.source[this.i++];
      if (ch === quote) break;
      if (ch === '\\') {
        const esc = this.source[this.i++];
        if (!esc) error('expression_invalid', 'Unterminated string escape');
        const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', "'": "'", '"': '"' };
        out += Object.hasOwn(map, esc) ? map[esc] : esc;
      } else out += ch;
      if (out.length > MAX_STRING_LENGTH) error('expression_invalid', 'String literal is too large');
    }
    this.bump();
    return this.syntaxOnly ? '' : out;
  }
  readPath(token) {
    const parts = token.split('.');
    if (!ROOT.test(parts[0]) || parts.length < 2) error('expression_invalid', 'Path must begin with an allowlisted root');
    if (parts.some(part => !PATH_SEGMENT.test(part) || RESERVED.has(part))) error('expression_invalid', 'Path contains a reserved or invalid field');
    if (this.syntaxOnly) {
      this.bump();
      return null;
    }
    let value = this.context?.[parts[0]];
    for (const part of parts.slice(1)) {
      if (value == null || typeof value !== 'object') value = undefined;
      else value = value[part];
    }
    if (value === undefined) error('expression_path_unavailable', 'Expression path is unavailable: ' + token, token);
    this.bump();
    return safeResult(value);
  }
  callFunction(name, args) {
    const one = () => {
      if (args.length !== 1) error('expression_invalid', name + ' requires exactly one argument');
      return args[0];
    };
    if (this.syntaxOnly) {
      if (['string', 'number', 'boolean', 'trim', 'lowercase', 'uppercase', 'exists', 'length'].includes(name) && args.length !== 1) {
        error('expression_invalid', name + ' requires exactly one argument');
      }
      if (name === 'join' && (args.length < 1 || args.length > 2)) error('expression_invalid', 'join() requires one or two arguments');
      if (name === 'coalesce' && args.length < 1) error('expression_invalid', 'coalesce() requires at least one argument');
      return null;
    }
    if (name === 'string') {
      const v = one();
      if (v === null) return '';
      if (typeof v === 'object') error('expression_type_error', 'string() does not coerce objects');
      return String(v);
    }
    if (name === 'number') {
      const v = one();
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) error('expression_evaluation_failed', 'number() result is not finite');
      return n;
    }
    if (name === 'boolean') {
      const v = one();
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      if (typeof v === 'string') return ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase());
      return Boolean(v);
    }
    if (name === 'trim' || name === 'lowercase' || name === 'uppercase') {
      const v = one();
      if (typeof v !== 'string') error('expression_type_error', name + '() requires a string');
      return name === 'trim' ? v.trim() : name === 'lowercase' ? v.toLowerCase() : v.toUpperCase();
    }
    if (name === 'join') {
      if (args.length < 1 || args.length > 2 || !Array.isArray(args[0]) || args[0].length > MAX_ARRAY_LENGTH) {
        error('expression_type_error', 'join() requires one bounded array and an optional separator');
      }
      const sep = args.length === 2 ? args[1] : ', ';
      if (typeof sep !== 'string' || sep.length > 10) error('expression_type_error', 'join() separator must be bounded text');
      return args[0].map(v => String(v)).join(sep);
    }
    if (name === 'coalesce') {
      if (args.length < 1) error('expression_invalid', 'coalesce() requires at least one argument');
      return args.find(v => v !== null && v !== undefined);
    }
    if (name === 'exists') {
      const v = one();
      return v !== null && v !== undefined;
    }
    if (name === 'length') {
      const v = one();
      if (typeof v === 'string' || Array.isArray(v)) return v.length;
      if (isPlainObject(v)) return Object.keys(v).length;
      error('expression_type_error', 'length() requires string, array or object');
    }
    error('expression_invalid', 'Function is not allowlisted: ' + name);
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function unwrap(source) {
  const value = boundedString(source, 'expression', MAX_EXPRESSION_LENGTH).trim();
  if (value.startsWith('{{') && value.endsWith('}}')) return value.slice(2, -2).trim();
  return value;
}

export function compileExpression(expression) {
  const source = unwrap(expression);
  if (!source) error('expression_invalid', 'Expression is required');
  const parser = new Parser(source, {}, true);
  parser.parse();
  return Object.freeze({ source, valid: true });
}

export function evaluateExpression({ expression, context = {} } = {}) {
  const source = unwrap(expression);
  if (!source) error('expression_invalid', 'Expression is required');
  if (!isPlainObject(context)) error('expression_invalid', 'Expression context must be a plain object');
  const parser = new Parser(source, context);
  return parser.parse();
}
