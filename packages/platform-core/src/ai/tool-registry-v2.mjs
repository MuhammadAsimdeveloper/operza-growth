/**
 * Phase 5 — Secure AI Tool Registry V2
 * Integrates with Phase 4 Integration Hub SDK, enforces strict argument schemas,
 * credential redaction, 5-tier risk classification, backend authorization,
 * human approval gating, idempotency, and audit recording.
 */

import { randomUUID } from 'node:crypto';

export const TOOL_RISK_CLASSES = Object.freeze({
  READ_ONLY: 'read_only',
  REVERSIBLE_WRITE: 'reversible_write',
  EXTERNAL_COMMUNICATION: 'external_communication',
  FINANCIAL_OPERATION: 'financial_operation',
  DESTRUCTIVE_OPERATION: 'destructive_operation'
});

const ROLE_RANK = Object.freeze({
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3
});

const HIGH_RISK_CLASSES = new Set([
  TOOL_RISK_CLASSES.EXTERNAL_COMMUNICATION,
  TOOL_RISK_CLASSES.FINANCIAL_OPERATION,
  TOOL_RISK_CLASSES.DESTRUCTIVE_OPERATION
]);

const CREDENTIAL_KEY_RE = /(password|secret|token|api[_-]?key|authorization|cookie|private[_-]?key)/i;

export function validateToolArgs(schema = {}, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, code: 'INVALID_TOOL_ARGS', message: 'Tool arguments must be a JSON object' };
  }

  const serialized = JSON.stringify(args);
  if (serialized.length > 16_000) {
    return { ok: false, code: 'TOOL_ARGS_TOO_LARGE', message: 'Tool arguments exceed 16 KB limit' };
  }
  if (CREDENTIAL_KEY_RE.test(serialized)) {
    return { ok: false, code: 'CREDENTIAL_IN_TOOL_ARGS', message: 'Credential-like fields are forbidden in tool arguments' };
  }

  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const field of required) {
    if (args[field] === undefined || args[field] === null || args[field] === '') {
      return { ok: false, code: 'MISSING_REQUIRED_FIELD', message: `Missing required argument: ${field}` };
    }
  }

  const props = schema.properties || {};
  for (const [key, value] of Object.entries(args)) {
    if (!Object.hasOwn(props, key)) {
      return { ok: false, code: 'UNDECLARED_TOOL_ARG', message: `Unexpected tool argument: ${key}` };
    }
    const spec = props[key];
    if (spec.type === 'string' && typeof value !== 'string') {
      return { ok: false, code: 'INVALID_ARG_TYPE', message: `Argument '${key}' must be a string` };
    }
    if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      return { ok: false, code: 'INVALID_ARG_TYPE', message: `Argument '${key}' must be a finite number` };
    }
    if (spec.type === 'boolean' && typeof value !== 'boolean') {
      return { ok: false, code: 'INVALID_ARG_TYPE', message: `Argument '${key}' must be a boolean` };
    }
    if (spec.type === 'array' && !Array.isArray(value)) {
      return { ok: false, code: 'INVALID_ARG_TYPE', message: `Argument '${key}' must be an array` };
    }
    if (Array.isArray(spec.enum) && !spec.enum.includes(value)) {
      return { ok: false, code: 'INVALID_ENUM_VALUE', message: `Argument '${key}' must be one of: ${spec.enum.join(', ')}` };
    }
  }

  return { ok: true };
}

export function createAiToolRegistry({ integrationSdk = null, auditSink = null } = {}) {
  const tools = new Map();
  const idempotencyReceipts = new Map();

  function registerTool(def) {
    if (!def?.id || !def?.name || typeof def?.handler !== 'function') {
      throw Object.assign(new TypeError('Tool id, name, and handler are required'), { code: 'INVALID_TOOL_DEF' });
    }
    const riskClass = def.riskClass || TOOL_RISK_CLASSES.READ_ONLY;
    if (!Object.values(TOOL_RISK_CLASSES).includes(riskClass)) {
      throw Object.assign(new TypeError(`Invalid riskClass: ${riskClass}`), { code: 'INVALID_RISK_CLASS' });
    }

    tools.set(def.id, {
      id: def.id,
      name: def.name,
      description: def.description || '',
      inputSchema: def.inputSchema || { type: 'object', properties: {} },
      outputSchema: def.outputSchema || { type: 'object', properties: {} },
      requiredRole: def.requiredRole || (riskClass === TOOL_RISK_CLASSES.READ_ONLY ? 'viewer' : 'member'),
      tenantRequired: def.tenantRequired !== false,
      readOnly: riskClass === TOOL_RISK_CLASSES.READ_ONLY,
      riskClass,
      requiresApproval: def.requiresApproval ?? HIGH_RISK_CLASSES.has(riskClass),
      timeoutMs: Number(def.timeoutMs || 5000),
      idempotencyRequired: def.idempotencyRequired ?? (riskClass !== TOOL_RISK_CLASSES.READ_ONLY),
      version: def.version || '1.0.0',
      handler: def.handler
    });
  }

  function listTools() {
    return Array.from(tools.values()).map(({ handler: _h, ...meta }) => meta);
  }

  function getTool(id) {
    return tools.get(id) || null;
  }

  function registerIntegrationSdkBridges() {
    if (!integrationSdk || typeof integrationSdk.list !== 'function') return 0;
    let count = 0;
    for (const connector of integrationSdk.list()) {
      const actionNames = Array.isArray(connector.actions)
        ? connector.actions
        : Object.keys(connector.actions || {});
      for (const action of actionNames) {
        const toolId = `integration.${connector.id}.${action}`;
        if (tools.has(toolId)) continue;
        registerTool({
          id: toolId,
          name: `${connector.name}: ${action}`,
          description: `Execute ${action} via Integration Hub connector ${connector.id}`,
          inputSchema: {
            type: 'object',
            properties: {
              payload: { type: 'string' }
            }
          },
          requiredRole: 'member',
          riskClass: TOOL_RISK_CLASSES.EXTERNAL_COMMUNICATION,
          requiresApproval: true,
          idempotencyRequired: true,
          version: connector.version || '1.0.0',
          handler: async (args, ctx) => {
            return integrationSdk.executeAction(connector.id, action, args, {
              tenantId: ctx.agencyId,
              idempotencyKey: ctx.idempotencyKey
            });
          }
        });
        count++;
      }
    }
    return count;
  }

  async function authorizeAndExecute({
    toolId,
    args = {},
    actor = {},
    tenantContext = {},
    approvalEvidence = null,
    idempotencyKey = null
  } = {}) {
    const tool = tools.get(toolId);
    if (!tool) {
      return { ok: false, status: 'denied', code: 'TOOL_NOT_REGISTERED', message: `Tool '${toolId}' is not registered` };
    }

    const agencyId = tenantContext?.agencyId;
    const locationId = tenantContext?.locationId;
    if (tool.tenantRequired && (!agencyId || !locationId)) {
      return { ok: false, status: 'denied', code: 'TENANT_CONTEXT_REQUIRED', message: 'Trusted tenant context is required' };
    }

    const role = actor?.membership?.role || actor?.role;
    if (!role || !Object.hasOwn(ROLE_RANK, role)) {
      return { ok: false, status: 'denied', code: 'ACTOR_UNAUTHENTICATED', message: 'Authenticated actor role required' };
    }
    if (ROLE_RANK[role] < ROLE_RANK[tool.requiredRole]) {
      return { ok: false, status: 'denied', code: 'FORBIDDEN_ROLE', message: `Role '${role}' lacks permission for '${tool.id}'` };
    }

    const argValidation = validateToolArgs(tool.inputSchema, args);
    if (!argValidation.ok) {
      return { ok: false, status: 'denied', code: argValidation.code, message: argValidation.message };
    }

    // Never bypass approval governance for high-risk or approval-gated tools
    if (tool.requiresApproval) {
      const approved = Boolean(
        approvalEvidence &&
        approvalEvidence.status === 'approved' &&
        approvalEvidence.toolId === tool.id &&
        approvalEvidence.approvedByActorId
      );
      if (!approved) {
        return {
          ok: false,
          status: 'proposal_required',
          code: 'HUMAN_APPROVAL_REQUIRED',
          requiresApproval: true,
          riskClass: tool.riskClass,
          message: `Tool '${tool.id}' (${tool.riskClass}) requires human approval before execution`
        };
      }
    }

    const effKey = idempotencyKey || `${agencyId}:${locationId}:${tool.id}:${randomUUID()}`;
    const receiptCacheKey = `${agencyId}:${locationId}:${tool.id}:${effKey}`;
    if (tool.idempotencyRequired && idempotencyKey && idempotencyReceipts.has(receiptCacheKey)) {
      return {
        ...idempotencyReceipts.get(receiptCacheKey),
        deduplicated: true
      };
    }

    const startedAt = Date.now();
    try {
      const result = await Promise.race([
        tool.handler(args, { agencyId, locationId, actor, idempotencyKey: effKey }),
        new Promise((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('Tool execution timed out'), { code: 'TOOL_TIMEOUT' })), tool.timeoutMs)
        )
      ]);
      const outcome = {
        ok: true,
        status: 'executed',
        toolId: tool.id,
        riskClass: tool.riskClass,
        idempotencyKey: effKey,
        durationMs: Date.now() - startedAt,
        result
      };
      if (tool.idempotencyRequired && idempotencyKey) {
        idempotencyReceipts.set(receiptCacheKey, outcome);
      }
      if (typeof auditSink === 'function') {
        await auditSink({
          event: 'ai.tool_executed',
          agencyId,
          locationId,
          actorId: actor?.user?.id || actor?.id || 'system',
          toolId: tool.id,
          riskClass: tool.riskClass,
          idempotencyKey: effKey
        });
      }
      return outcome;
    } catch (err) {
      return {
        ok: false,
        status: 'failed',
        toolId: tool.id,
        code: err?.code || 'TOOL_EXECUTION_FAILED',
        message: err?.message || 'Tool execution failed',
        durationMs: Date.now() - startedAt
      };
    }
  }

  return {
    registerTool,
    listTools,
    getTool,
    registerIntegrationSdkBridges,
    authorizeAndExecute
  };
}
