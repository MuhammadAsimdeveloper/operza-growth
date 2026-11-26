/**
 * ============================================================================
 * Operza Workflow Engine 2.0 — Deterministic Branch & Safe Data-Op Executor
 * ============================================================================
 * Supports sequential, if/else, AND/OR, multi-branch switch, bounded parallel
 * split/merge barriers, bounded loops, durable wait/approval pauses, and
 * zero-eval deterministic data transformations with redacted step I/O.
 */

import { evaluateCondition, renderTemplate } from './engine.mjs';
import { normalizeGovernancePolicy, redactSensitivePayload, validateWorkflowGraphV2 } from './graph-validator-v2.mjs';

function resolvePath(obj, path) {
  if (typeof path !== 'string') return undefined;
  return path.split('.').filter(Boolean).reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

export function evaluateCompoundRules(ruleGroup, context) {
  if (!ruleGroup || typeof ruleGroup !== 'object') return false;
  const combinator = String(ruleGroup.combinator || 'AND').toUpperCase();
  const rules = Array.isArray(ruleGroup.rules) ? ruleGroup.rules : [];
  if (rules.length === 0) return true;
  const evalEntry = (entry) => {
    if (Array.isArray(entry?.rules)) return evaluateCompoundRules(entry, context);
    return evaluateCondition(entry, context);
  };
  return combinator === 'OR' ? rules.some(evalEntry) : rules.every(evalEntry);
}

export function executeSafeDataOperation(nodeType, config = {}, context = {}) {
  const vars = { ...(context.variables || {}) };
  switch (nodeType) {
    case 'set_variable': {
      const key = String(config.key || '').trim();
      if (!key) throw Object.assign(new TypeError('set_variable requires config.key'), { code: 'INVALID_DATA_OP' });
      const val = typeof config.value === 'string' ? renderTemplate(config.value, context) : config.value;
      vars[key] = val;
      return { variables: vars, output: { [key]: val } };
    }
    case 'map_fields': {
      const mappings = config.mappings && typeof config.mappings === 'object' ? config.mappings : {};
      const mapped = {};
      for (const [targetKey, sourcePath] of Object.entries(mappings)) {
        mapped[targetKey] = typeof sourcePath === 'string' ? resolvePath(context, sourcePath) : sourcePath;
      }
      return { variables: { ...vars, ...mapped }, output: mapped };
    }
    case 'format_data': {
      const formatted = renderTemplate(String(config.template || ''), context);
      const targetKey = String(config.targetKey || 'formatted').trim();
      vars[targetKey] = formatted;
      return { variables: vars, output: { [targetKey]: formatted } };
    }
    case 'validate_data': {
      const requiredFields = Array.isArray(config.requiredFields) ? config.requiredFields : [];
      const missing = requiredFields.filter(f => {
        const v = resolvePath(context, String(f));
        return v === undefined || v === null || v === '';
      });
      return { variables: vars, output: { valid: missing.length === 0, missing } };
    }
    case 'convert_types': {
      const raw = resolvePath(context, String(config.sourcePath || ''));
      const toType = String(config.toType || 'string');
      let converted = raw;
      if (toType === 'number') converted = Number(raw);
      else if (toType === 'boolean') converted = raw === true || raw === 'true' || raw === 1 || raw === '1';
      else if (toType === 'iso_date') converted = raw ? new Date(raw).toISOString() : null;
      else converted = raw == null ? '' : String(raw);
      const targetKey = String(config.targetKey || 'converted');
      vars[targetKey] = converted;
      return { variables: vars, output: { [targetKey]: converted } };
    }
    case 'parse_json': {
      const raw = resolvePath(context, String(config.sourcePath || ''));
      const text = typeof raw === 'string' ? raw : String(config.json || '{}');
      if (text.length > 65_536) throw Object.assign(new TypeError('JSON input too large'), { code: 'PAYLOAD_TOO_LARGE' });
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && ('__proto__' in parsed || 'constructor' in parsed)) {
        throw Object.assign(new TypeError('Unsafe JSON key'), { code: 'UNSAFE_JSON' });
      }
      const targetKey = String(config.targetKey || 'parsed');
      vars[targetKey] = parsed;
      return { variables: vars, output: { [targetKey]: parsed } };
    }
    case 'date_time': {
      const base = config.baseDate ? new Date(renderTemplate(String(config.baseDate), context)) : new Date();
      const addMinutes = Number(config.addMinutes) || 0;
      const computed = new Date(base.getTime() + addMinutes * 60_000).toISOString();
      const targetKey = String(config.targetKey || 'computedDate');
      vars[targetKey] = computed;
      return { variables: vars, output: { [targetKey]: computed } };
    }
    case 'string_transform': {
      const raw = String(resolvePath(context, String(config.sourcePath || '')) ?? '');
      const op = String(config.operation || 'trim');
      let result = raw;
      if (op === 'trim') result = raw.trim();
      else if (op === 'lower') result = raw.toLowerCase();
      else if (op === 'upper') result = raw.toUpperCase();
      else if (op === 'slug') result = raw.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const targetKey = String(config.targetKey || 'transformed');
      vars[targetKey] = result;
      return { variables: vars, output: { [targetKey]: result } };
    }
    case 'filter_array': {
      const list = resolvePath(context, String(config.sourcePath || ''));
      if (!Array.isArray(list)) return { variables: vars, output: { items: [], count: 0 } };
      const bounded = list.slice(0, 1000);
      const rule = config.rule;
      const filtered = rule ? bounded.filter(item => evaluateCondition(rule, { ...context, item })) : bounded;
      const targetKey = String(config.targetKey || 'filteredItems');
      vars[targetKey] = filtered;
      return { variables: vars, output: { [targetKey]: filtered, count: filtered.length } };
    }
    default:
      throw Object.assign(new TypeError(`Unsupported data operation: ${nodeType}`), { code: 'UNKNOWN_DATA_OP' });
  }
}

export async function executeWorkflowGraphV2({
  nodes = [],
  edges = [],
  trigger = null,
  initialContext = {},
  governancePolicy = {},
  actionExecutor = null,
  cancelled = () => false
} = {}) {
  const validation = validateWorkflowGraphV2({ nodes, edges, trigger, governancePolicy });
  if (!validation.valid) {
    return {
      status: 'failed',
      errorCode: validation.errors[0]?.code || 'INVALID_GRAPH',
      errors: validation.errors,
      steps: [],
      branchStates: {}
    };
  }

  const policy = normalizeGovernancePolicy(governancePolicy);
  const nodeMap = new Map(nodes.map(n => [n.id, { ...n, kind: n.kind || n.type }]));
  const outEdges = new Map(nodes.map(n => [n.id, []]));
  const inEdges = new Map(nodes.map(n => [n.id, []]));

  for (const edge of edges) {
    if (outEdges.has(edge.source)) outEdges.get(edge.source).push(edge);
    if (inEdges.has(edge.target)) inEdges.get(edge.target).push(edge);
  }

  // Root nodes: connected from 'trigger' or nodes with 0 incoming edges
  const triggerTargets = edges.filter(e => e.source === 'trigger').map(e => e.target);
  const roots = triggerTargets.length > 0
    ? triggerTargets
    : nodes.filter(n => (inEdges.get(n.id)?.length || 0) === 0).map(n => n.id);

  let context = { ...initialContext, variables: { ...(initialContext.variables || {}) } };
  const steps = [];
  const completedNodes = new Set();
  const skippedNodes = new Set();
  const branchStates = {};
  const queue = [...new Set(roots)];
  let stepCounter = 0;

  while (queue.length > 0) {
    if (cancelled()) {
      return { status: 'canceled', steps, context: redactSensitivePayload(context), branchStates };
    }
    if (stepCounter >= policy.maxSteps) {
      return { status: 'failed', errorCode: 'MAX_STEPS_EXCEEDED', steps, context: redactSensitivePayload(context), branchStates };
    }

    const nodeId = queue.shift();
    if (completedNodes.has(nodeId) || skippedNodes.has(nodeId)) continue;
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    // Join barrier check for merge nodes
    if (node.kind === 'merge') {
      const parents = inEdges.get(nodeId).map(e => e.source).filter(s => s !== 'trigger');
      const mode = String(node.config?.mode || 'all');
      const doneCount = parents.filter(p => completedNodes.has(p)).length;
      const settledCount = parents.filter(p => completedNodes.has(p) || skippedNodes.has(p)).length;
      if (mode === 'all' && settledCount < parents.length) {
        queue.push(nodeId);
        continue;
      }
      if (mode === 'any' && doneCount === 0 && settledCount < parents.length) {
        queue.push(nodeId);
        continue;
      }
    }

    stepCounter += 1;
    const config = node.config || {};
    const startedAt = new Date().toISOString();
    let stepOutput = {};
    let selectedHandles = null;

    try {
      if (node.kind === 'condition') {
        const matched = evaluateCondition(config.rule || { field: 'contact.status', operator: 'is_not_empty', value: '' }, context);
        selectedHandles = [matched ? 'yes' : 'no'];
        stepOutput = { matched, branch: selectedHandles[0] };
      } else if (node.kind === 'and_or_condition') {
        const matched = evaluateCompoundRules(config.ruleGroup || { combinator: 'AND', rules: [] }, context);
        selectedHandles = [matched ? 'yes' : 'no'];
        stepOutput = { matched, branch: selectedHandles[0] };
      } else if (node.kind === 'switch') {
        const val = String(resolvePath(context, String(config.field || '')) ?? '');
        const cases = Array.isArray(config.cases) ? config.cases : [];
        const hit = cases.find(c => String(c.value) === val);
        selectedHandles = [hit ? hit.handle : 'default'];
        stepOutput = { value: val, branch: selectedHandles[0] };
      } else if (node.kind === 'split_branches') {
        const outgoing = outEdges.get(nodeId) || [];
        if (outgoing.length > policy.maxParallelBranches) {
          throw Object.assign(new Error('Parallel branch limit exceeded'), { code: 'MAX_PARALLEL_BRANCHES_EXCEEDED' });
        }
        selectedHandles = outgoing.map(e => e.sourceHandle || 'default');
        stepOutput = { fannedOut: outgoing.length };
      } else if (node.kind === 'loop_items') {
        const items = Array.isArray(resolvePath(context, String(config.sourcePath || 'items')))
          ? resolvePath(context, String(config.sourcePath || 'items'))
          : [];
        const maxIter = Math.min(Number(config.maxIterations) || policy.maxLoopIterations, policy.maxLoopIterations);
        if (items.length > maxIter) {
          throw Object.assign(new Error(`Loop items (${items.length}) exceed maxLoopIterations (${maxIter})`), { code: 'MAX_LOOP_ITERATIONS_EXCEEDED' });
        }
        stepOutput = { iterations: items.length, maxIterations: maxIter };
      } else if (node.kind === 'wait' || node.kind === 'schedule_delay') {
        steps.push({
          nodeId,
          kind: node.kind,
          status: 'waiting',
          input: redactSensitivePayload(config),
          output: { waitType: 'timed', delayMinutes: Number(config.delayMinutes) || 0 },
          startedAt,
          finishedAt: new Date().toISOString()
        });
        return {
          status: 'waiting',
          waitType: 'timed',
          resumeNodeId: (outEdges.get(nodeId) || [])[0]?.target || null,
          steps,
          context: redactSensitivePayload(context),
          branchStates
        };
      } else if (node.kind === 'approval_gate') {
        steps.push({
          nodeId,
          kind: node.kind,
          status: 'waiting_approval',
          input: redactSensitivePayload(config),
          output: { waitType: 'approval' },
          startedAt,
          finishedAt: new Date().toISOString()
        });
        return {
          status: 'waiting_approval',
          waitType: 'approval',
          resumeNodeId: (outEdges.get(nodeId) || [])[0]?.target || null,
          steps,
          context: redactSensitivePayload(context),
          branchStates
        };
      } else if (node.kind === 'stop') {
        completedNodes.add(nodeId);
        steps.push({
          nodeId,
          kind: node.kind,
          status: 'completed',
          input: {},
          output: { stopped: true, reason: config.reason || 'Workflow stop node reached' },
          startedAt,
          finishedAt: new Date().toISOString()
        });
        return { status: 'completed', steps, context: redactSensitivePayload(context), branchStates };
      } else if ([
        'set_variable', 'map_fields', 'format_data', 'validate_data',
        'convert_types', 'parse_json', 'date_time', 'string_transform', 'filter_array'
      ].includes(node.kind)) {
        const res = executeSafeDataOperation(node.kind, config, context);
        context = { ...context, variables: res.variables };
        stepOutput = res.output;
      } else if (typeof actionExecutor === 'function') {
        stepOutput = await actionExecutor({ node, context });
      } else {
        stepOutput = { simulated: true, kind: node.kind };
      }

      completedNodes.add(nodeId);
      branchStates[nodeId] = 'completed';
      steps.push({
        nodeId,
        kind: node.kind,
        status: 'completed',
        input: redactSensitivePayload(config),
        output: redactSensitivePayload(stepOutput),
        startedAt,
        finishedAt: new Date().toISOString()
      });

      const outgoing = outEdges.get(nodeId) || [];
      for (const edge of outgoing) {
        const handle = edge.sourceHandle || edge.label || 'default';
        if (selectedHandles && !selectedHandles.includes(handle) && !selectedHandles.includes(handle.toLowerCase())) {
          skippedNodes.add(edge.target);
          branchStates[edge.target] = 'skipped';
        } else {
          queue.push(edge.target);
        }
      }
    } catch (err) {
      branchStates[nodeId] = 'failed';
      steps.push({
        nodeId,
        kind: node.kind,
        status: 'failed',
        errorCode: err?.code || 'NODE_EXECUTION_ERROR',
        error: err?.message || 'Node execution failed',
        input: redactSensitivePayload(config),
        output: null,
        startedAt,
        finishedAt: new Date().toISOString()
      });
      return {
        status: 'failed',
        errorCode: err?.code || 'NODE_EXECUTION_ERROR',
        failedNodeId: nodeId,
        steps,
        context: redactSensitivePayload(context),
        branchStates
      };
    }
  }

  return {
    status: 'completed',
    steps,
    context: redactSensitivePayload(context),
    branchStates
  };
}
