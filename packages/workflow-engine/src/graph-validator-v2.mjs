/**
 * ============================================================================
 * Operza Workflow Builder 2.0 — Graph Validator & Debug Redaction
 * ============================================================================
 */

import { getNodeDefinitionV2, validateNodeConfigV2 } from './node-registry-v2.mjs';

const DEFAULT_GOVERNANCE_POLICY = Object.freeze({
  maxNodes: 200,
  maxSteps: 500,
  maxLoopIterations: 100,
  maxParallelBranches: 10,
  maxDurationMs: 300_000,
  maxPayloadBytes: 262_144,
  maxRetries: 3,
  maxQueuedExecutions: 100
});

const SENSITIVE_KEY_RE = /(password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|client[_-]?secret|ssn|card[_-]?number)/i;

export function normalizeGovernancePolicy(policy = {}) {
  return {
    maxNodes: Math.min(500, Math.max(1, Number(policy?.maxNodes) || DEFAULT_GOVERNANCE_POLICY.maxNodes)),
    maxSteps: Math.min(2000, Math.max(1, Number(policy?.maxSteps) || DEFAULT_GOVERNANCE_POLICY.maxSteps)),
    maxLoopIterations: Math.min(500, Math.max(1, Number(policy?.maxLoopIterations) || DEFAULT_GOVERNANCE_POLICY.maxLoopIterations)),
    maxParallelBranches: Math.min(25, Math.max(1, Number(policy?.maxParallelBranches) || DEFAULT_GOVERNANCE_POLICY.maxParallelBranches)),
    maxDurationMs: Math.min(3_600_000, Math.max(1000, Number(policy?.maxDurationMs) || DEFAULT_GOVERNANCE_POLICY.maxDurationMs)),
    maxPayloadBytes: Math.min(1_048_576, Math.max(1024, Number(policy?.maxPayloadBytes) || DEFAULT_GOVERNANCE_POLICY.maxPayloadBytes)),
    maxRetries: Math.min(10, Math.max(0, Number(policy?.maxRetries ?? DEFAULT_GOVERNANCE_POLICY.maxRetries))),
    maxQueuedExecutions: Math.min(1000, Math.max(1, Number(policy?.maxQueuedExecutions) || DEFAULT_GOVERNANCE_POLICY.maxQueuedExecutions))
  };
}

export function validateWorkflowGraphV2({ nodes = [], edges = [], trigger = null, governancePolicy = {} } = {}) {
  const errors = [];
  const warnings = [];
  const policy = normalizeGovernancePolicy(governancePolicy);

  if (!Array.isArray(nodes)) {
    return { valid: false, errors: [{ code: 'INVALID_NODES', message: 'nodes must be an array' }], warnings, policy };
  }
  if (!Array.isArray(edges)) {
    return { valid: false, errors: [{ code: 'INVALID_EDGES', message: 'edges must be an array' }], warnings, policy };
  }
  if (nodes.length > policy.maxNodes) {
    errors.push({ code: 'MAX_NODES_EXCEEDED', message: `Workflow exceeds maxNodes (${nodes.length} > ${policy.maxNodes})` });
  }

  const serializedBytes = Buffer.byteLength(JSON.stringify({ nodes, edges, trigger }), 'utf8');
  if (serializedBytes > policy.maxPayloadBytes) {
    errors.push({ code: 'MAX_PAYLOAD_EXCEEDED', message: `Workflow definition size (${serializedBytes} bytes) exceeds ${policy.maxPayloadBytes} bytes` });
  }

  if (trigger && trigger.kind) {
    const trigDef = getNodeDefinitionV2(trigger.kind);
    if (!trigDef || trigDef.category !== 'triggers') {
      errors.push({ code: 'INVALID_TRIGGER', message: `Unsupported trigger kind "${trigger.kind}"` });
    }
  }

  const nodeMap = new Map();
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id.trim()) {
      errors.push({ code: 'INVALID_NODE_ID', message: 'Every node requires a non-empty string id' });
      continue;
    }
    if (nodeMap.has(node.id)) {
      errors.push({ code: 'DUPLICATE_NODE_ID', nodeId: node.id, message: `Duplicate node id "${node.id}"` });
      continue;
    }
    const nodeType = node.kind || node.type;
    const validation = validateNodeConfigV2(nodeType, node.config || {});
    if (!validation.valid) {
      for (const err of validation.errors) {
        errors.push({ ...err, nodeId: node.id });
      }
    } else if (validation.definition?.riskLevel === 'high' && nodeType !== 'approval_gate') {
      const hasPriorApproval = edges.some(e => e.target === node.id && nodeMap.get(e.source)?.kind === 'approval_gate');
      if (!hasPriorApproval) {
        warnings.push({
          code: 'HIGH_RISK_WITHOUT_APPROVAL',
          nodeId: node.id,
          message: `High-risk node "${node.label || nodeType}" has no preceding approval_gate`
        });
      }
    }
    nodeMap.set(node.id, { ...node, kind: nodeType });
  }

  const edgeIds = new Set();
  const outgoing = new Map();
  const incomingCount = new Map();
  for (const id of nodeMap.keys()) {
    outgoing.set(id, []);
    incomingCount.set(id, 0);
  }

  for (const edge of edges) {
    if (!edge || typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      errors.push({ code: 'INVALID_EDGE', message: 'Edge requires source and target node IDs' });
      continue;
    }
    if (edge.id) {
      if (edgeIds.has(edge.id)) {
        errors.push({ code: 'DUPLICATE_EDGE_ID', edgeId: edge.id, message: `Duplicate edge id "${edge.id}"` });
      }
      edgeIds.add(edge.id);
    }
    if (edge.source === edge.target) {
      errors.push({ code: 'SELF_LOOP', nodeId: edge.source, message: `Self-loop on node "${edge.source}" is forbidden` });
      continue;
    }
    const srcNode = nodeMap.get(edge.source);
    const tgtNode = nodeMap.get(edge.target);
    if (!srcNode && edge.source !== 'trigger') {
      errors.push({ code: 'MISSING_EDGE_SOURCE', edgeId: edge.id, message: `Edge source "${edge.source}" does not exist` });
      continue;
    }
    if (!tgtNode) {
      errors.push({ code: 'MISSING_EDGE_TARGET', edgeId: edge.id, message: `Edge target "${edge.target}" does not exist` });
      continue;
    }
    if (srcNode?.kind === 'stop') {
      errors.push({ code: 'STOP_NODE_HAS_OUTGOING', nodeId: srcNode.id, message: 'Stop node cannot have outgoing connections' });
    }
    const tgtDef = getNodeDefinitionV2(tgtNode.kind);
    if (tgtDef?.category === 'triggers') {
      errors.push({ code: 'TRIGGER_CANNOT_BE_TARGET', nodeId: tgtNode.id, message: 'Trigger node cannot have incoming connections' });
    }
    if (edge.source !== 'trigger') {
      outgoing.get(edge.source).push(edge);
      incomingCount.set(edge.target, (incomingCount.get(edge.target) || 0) + 1);
    }
  }

  // Parallel branch cap
  for (const [nodeId, outEdges] of outgoing.entries()) {
    if (outEdges.length > policy.maxParallelBranches) {
      errors.push({
        code: 'MAX_PARALLEL_BRANCHES_EXCEEDED',
        nodeId,
        message: `Node "${nodeId}" fans out to ${outEdges.length} branches (max ${policy.maxParallelBranches})`
      });
    }
  }

  // Cycle detection via Kahn's topological sort
  const inDeg = new Map(incomingCount);
  const queue = [];
  for (const [id, deg] of inDeg.entries()) {
    if (deg === 0) queue.push(id);
  }
  let visited = 0;
  while (queue.length > 0) {
    const cur = queue.shift();
    visited += 1;
    for (const edge of outgoing.get(cur) || []) {
      const next = (inDeg.get(edge.target) || 0) - 1;
      inDeg.set(edge.target, next);
      if (next === 0) queue.push(edge.target);
    }
  }
  if (visited < nodeMap.size) {
    errors.push({ code: 'CYCLE_DETECTED', message: 'Workflow graph contains a cycle; use bounded loop_items node for iteration' });
  }

  // Unreachable node warning
  const triggerRoots = new Set(edges.filter(e => e.source === 'trigger').map(e => e.target));
  for (const [id, deg] of incomingCount.entries()) {
    const node = nodeMap.get(id);
    const defItem = getNodeDefinitionV2(node.kind);
    if (deg === 0 && !triggerRoots.has(id) && defItem?.category !== 'triggers' && nodes.length > 1) {
      warnings.push({ code: 'UNREACHABLE_NODE', nodeId: id, message: `Node "${node.label || id}" has no incoming connection` });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    policy
  };
}

export function redactSensitivePayload(value, depth = 0, seen = new WeakSet()) {
  if (depth > 8) return '[TRUNCATED_DEPTH]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (/^Bearer\s+/i.test(value)) return '[REDACTED_AUTH]';
    return value.length > 1000 ? `${value.slice(0, 997)}...` : value;
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) {
    const sliced = value.slice(0, 100).map(item => redactSensitivePayload(item, depth + 1, seen));
    seen.delete(value);
    return sliced;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactSensitivePayload(v, depth + 1, seen);
    }
  }
  seen.delete(value);
  return out;
}
