import { randomUUID } from 'node:crypto';
const ROLE_RANK = Object.freeze({ viewer: 0, member: 1, admin: 2, owner: 3 });
const READ_TOOLS = new Set(['search_contacts', 'get_pipeline_summary', 'get_calendar_availability']);
const TOOL_RISK = Object.freeze({
  search_contacts: 'read',
  get_pipeline_summary: 'read',
  get_calendar_availability: 'read',
  create_contact: 'write',
  create_task: 'write',
  book_appointment: 'write',
  update_opportunity_stage: 'write',
  trigger_workflow: 'workflow',
  send_communication: 'external_side_effect'
});

export function getCopilotToolDefinition(toolName) {
  if (typeof toolName !== 'string' || !Object.hasOwn(TOOL_RISK, toolName)) return null;
  const risk = TOOL_RISK[toolName];
  return { toolName, risk, readOnly: READ_TOOLS.has(toolName) };
}

export function authorizeCopilotTool({
  toolName,
  actorRole,
  tenantCapability = true,
  agentGrant = true
} = {}) {
  const definition = getCopilotToolDefinition(toolName);
  if (!definition) return { decision: 'deny', code: 'TOOL_NOT_REGISTERED' };
  if (typeof actorRole !== 'string' || !Object.hasOwn(ROLE_RANK, actorRole)) return { decision: 'deny', code: 'ACTOR_ROLE_INVALID' };
  if (agentGrant !== true) return { decision: 'deny', code: 'AGENT_GRANT_MISSING' };
  if (tenantCapability !== true) return { decision: 'deny', code: 'TENANT_CAPABILITY_DISABLED' };
  if (definition.readOnly) return { decision: 'allow_read', code: 'READ_ONLY_TOOL' };
  if (ROLE_RANK[actorRole] < ROLE_RANK.member) return { decision: 'deny', code: 'ACTOR_ROLE_FORBIDDEN' };
  return {
    decision: 'proposal_only',
    code: 'HUMAN_REVIEW_REQUIRED',
    requiresHumanApproval: true,
    risk: definition.risk
  };
}

export function createCopilotProposal({ tenantId, locationId, actorId, toolName, params = {}, actorRole = 'member', tenantCapability = true, agentGrant = true, now = Date.now(), id = randomUUID() } = {}) {
  if (![tenantId, locationId, actorId].every(value => typeof value === 'string' && value.length >= 3 && value.length <= 180)) {
    throw Object.assign(new TypeError('Proposal identity is invalid'), { code: 'INVALID_PROPOSAL_IDENTITY' });
  }
  const authorization = authorizeCopilotTool({ toolName, actorRole, tenantCapability, agentGrant });
  if (authorization.decision !== 'proposal_only') {
    throw Object.assign(new TypeError('Tool is not a proposal-only action'), { code: 'TOOL_NOT_PROPOSABLE' });
  }
  if (!params || typeof params !== 'object' || Array.isArray(params) || JSON.stringify(params).length > 12_000) {
    throw Object.assign(new TypeError('Proposal parameters are invalid or too large'), { code: 'INVALID_PROPOSAL_PARAMS' });
  }
  const serialized = JSON.stringify(params);
  if (/(password|secret|token|api[_-]?key|authorization|cookie)/i.test(serialized)) {
    throw Object.assign(new TypeError('Proposal cannot contain credentials'), { code: 'CREDENTIAL_IN_PROPOSAL' });
  }
  return {
    id,
    tenantId,
    locationId,
    requestedByActorId: actorId,
    toolName,
    params: structuredClone(params),
    risk: authorization.risk,
    status: 'pending_review',
    requiresHumanApproval: true,
    createdAt: new Date(now).toISOString(),
    decidedAt: null,
    decidedByActorId: null
  };
}
