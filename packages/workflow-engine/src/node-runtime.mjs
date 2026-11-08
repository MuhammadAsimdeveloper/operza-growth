/**
 * ============================================================================
 * Operza Workflow Engine: Advanced Flow & Data Node Runtime
 * ============================================================================
 * Ported from Atlas Automation Fabric. Executes high-throughput data manipulation
 * nodes (looping, splitting, merging, aggregation, sorting, deduplication, and filtering).
 */

import crypto from 'node:crypto';
import { validateDataMapping, applyDataMapping } from './safe-data-mapping.mjs';

const MAX_ITEMS = 1000;
const MAX_STEPS = 500;
const REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/;

const sha = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ref = (v, l) => {
  if (typeof v !== 'string' || !REF.test(v)) throw new TypeError(l + ' must be a bounded reference');
  return v;
};
const int = (v, l, min, max) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new TypeError(l + ' must be ' + min + '-' + max);
  return v;
};
const arr = (v, l, max = MAX_ITEMS) => {
  if (!Array.isArray(v) || v.length > max) throw new TypeError(l + ' must be a bounded array');
  return v;
};
const clone = v => structuredClone(v);
const pathGet = (obj, path) => String(path).split('.').filter(Boolean).reduce((v, k) => v == null ? undefined : v[k], obj);

function itemKey(item, key) {
  const value = pathGet(item, key);
  return JSON.stringify(value === undefined ? null : value);
}

function compare(a, b, key, direction = 'asc') {
  const av = pathGet(a, key);
  const bv = pathGet(b, key);
  if (av === bv) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  const n = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
  return direction === 'desc' ? -n : n;
}

function boundedKey(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.]{0,179}$/.test(value)) throw new TypeError(label + ' is invalid');
  return value;
}

export function executeAdvancedNode({ tenantId = 'operza_tenant', node, input = [], context = {}, policy = {}, now = Date.now() } = {}) {
  const type = node?.type;
  const config = node?.config || {};
  const items = arr(input, 'input', policy.maxLoopItems || MAX_ITEMS);
  const maxItems = Math.min(policy.maxLoopItems || MAX_ITEMS, MAX_ITEMS);
  const maxSteps = policy.maxSteps || MAX_STEPS;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS) throw new TypeError('maxSteps out of bounds');

  switch (type) {
    case 'no_op':
      return { items: clone(items), control: { status: 'continue' } };

    case 'loop_over_items':
    case 'loop_items': {
      const batchSize = int(config.batchSize ?? 1, 'batchSize', 1, 100);
      const limited = items.slice(0, maxItems);
      const batches = [];
      for (let i = 0; i < limited.length; i += batchSize) {
        batches.push(limited.slice(i, i + batchSize));
      }
      return {
        items: batches.flat(),
        control: { status: 'loop', batches, totalItems: limited.length, maxIterations: batches.length }
      };
    }

    case 'split_out': {
      const field = String(config.field || 'items');
      const out = [];
      for (const item of items) {
        const value = pathGet(item, field);
        if (!Array.isArray(value)) continue;
        for (const child of value.slice(0, maxItems - out.length)) {
          out.push({ ...item, item: child });
        }
        if (out.length >= maxItems) break;
      }
      return { items: out, control: { status: 'continue' } };
    }

    case 'merge': {
      const mergeInputs = Array.isArray(context.mergeInputs) ? context.mergeInputs : [];
      if (mergeInputs.length > 10 || mergeInputs.some(value => !Array.isArray(value) || value.length > maxItems)) {
        throw new TypeError('mergeInputs must contain <=10 bounded arrays');
      }
      const inputs = [items, ...mergeInputs];
      const mode = String(config.mode || 'append');
      const limit = config.maxItems ?? maxItems;
      int(limit, 'merge maxItems', 1, maxItems);

      if (!['append', 'combine_by_position', 'merge_by_key'].includes(mode)) throw new TypeError('merge mode is unsupported');

      if (mode === 'append') {
        return { items: clone(inputs.flat().slice(0, limit)), control: { status: 'continue', mergeMode: mode, inputCount: inputs.length } };
      }

      if (mode === 'combine_by_position') {
        const length = Math.min(limit, Math.max(...inputs.map(value => value.length), 0));
        const output = [];
        for (let index = 0; index < length; index += 1) {
          const merged = {};
          for (const source of inputs) {
            if (source[index] && typeof source[index] === 'object' && !Array.isArray(source[index])) {
              Object.assign(merged, source[index]);
            }
          }
          output.push(merged);
        }
        return { items: clone(output), control: { status: 'continue', mergeMode: mode, inputCount: inputs.length } };
      }

      // merge_by_key
      const key = boundedKey(String(config.key || 'id'), 'merge key');
      const includeUnmatched = config.includeUnmatched === true;
      const output = [];
      const indexes = new Map();
      for (const item of inputs[0]) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const identity = itemKey(item, key);
        if (!indexes.has(identity)) {
          indexes.set(identity, output.length);
          output.push({ ...item });
        }
      }
      for (const source of inputs.slice(1)) {
        for (const item of source) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
          const identity = itemKey(item, key);
          const index = indexes.get(identity);
          if (index !== undefined) {
            Object.assign(output[index], item);
          } else if (includeUnmatched && output.length < limit) {
            indexes.set(identity, output.length);
            output.push({ ...item });
          }
        }
      }
      return { items: clone(output.slice(0, limit)), control: { status: 'continue', mergeMode: mode, inputCount: inputs.length } };
    }

    case 'aggregate': {
      const operation = String(config.operation || 'count');
      const field = String(config.field || '');
      if (!['count', 'sum', 'avg', 'min', 'max'].includes(operation)) throw new TypeError('aggregate operation is unsupported');
      if (operation !== 'count') boundedKey(field, 'aggregate field');

      const values = items.slice(0, maxItems).map(item => field ? pathGet(item, field) : undefined);
      if (operation === 'count') return { items: [{ operation, value: items.length, count: items.length }], control: { status: 'continue' } };

      if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
        throw new TypeError('aggregate values must be finite numbers');
      }
      if (!values.length) return { items: [{ operation, value: 0, count: 0, field }], control: { status: 'continue' } };

      const value = operation === 'sum'
        ? values.reduce((total, item) => total + item, 0)
        : operation === 'avg'
          ? values.reduce((total, item) => total + item, 0) / values.length
          : operation === 'min'
            ? Math.min(...values)
            : Math.max(...values);
      return { items: [{ operation, value, count: values.length, field }], control: { status: 'continue' } };
    }

    case 'remove_duplicates': {
      const key = boundedKey(String(config.key || 'id'), 'remove_duplicates key');
      const seen = new Set();
      const out = [];
      for (const item of items.slice(0, maxItems)) {
        const k = itemKey(item, key);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(item);
      }
      return { items: clone(out), control: { status: 'continue' } };
    }

    case 'sort': {
      const key = boundedKey(String(config.key || 'id'), 'sort key');
      const direction = config.direction === 'desc' ? 'desc' : 'asc';
      const out = clone(items.slice(0, maxItems));
      out.sort((a, b) => compare(a, b, key, direction));
      return { items: out, control: { status: 'continue' } };
    }

    case 'filter':
    case 'filter_array':
    case 'data_filter': {
      const key = String(config.key || config.field || '');
      const op = config.operator || 'equals';
      const expected = config.value;
      const out = items.filter(item => {
        const actual = pathGet(item, key);
        if (op === 'equals') return actual === expected;
        if (op === 'not_equals') return actual !== expected;
        if (op === 'contains') return Array.isArray(actual) ? actual.includes(expected) : typeof actual === 'string' && actual.includes(String(expected));
        if (op === 'exists') return actual !== undefined && actual !== null;
        if (op === 'gt') return typeof actual === 'number' && actual > Number(expected);
        if (op === 'lt') return typeof actual === 'number' && actual < Number(expected);
        return false;
      });
      return { items: clone(out), control: { status: 'continue' } };
    }

    case 'edit_fields': {
      const mapping = validateDataMapping({ mapping: config.mapping });
      const out = items.slice(0, maxItems).map(item => applyDataMapping({ mapping, context: { ...context, input: item } }));
      return { items: out, control: { status: 'continue' } };
    }

    default:
      throw new Error('Unsupported advanced flow node type: ' + type);
  }
}
