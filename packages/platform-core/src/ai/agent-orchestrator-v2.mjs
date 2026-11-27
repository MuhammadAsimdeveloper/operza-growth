/**
 * ============================================================================
 * Operza Agent Engine 2.0 — Validated Planning & Bounded Multi-Agent Orchestrator
 * ============================================================================
 * Enforces structured plan validation before tool calls, 10 specialized agent
 * profiles, bounded delegation depth (<=3), and strict permission intersection.
 */

import { randomUUID } from 'node:crypto';

export const MAX_DELEGATION_DEPTH = 3;
export const MAX_PLAN_STEPS = 20;

export const SPECIALIZED_AGENTS = Object.freeze({
  research: {
    type: 'research',
    purpose: 'Investigate workspace knowledge and summarize verified findings with citations.',
    allowedTools: ['search_knowledge', 'search_contacts'],
    requiredRole: 'viewer',
    maxSteps: 6,
    approvalPolicy: 'read_only'
  },
  crm_assistant: {
    type: 'crm_assistant',
    purpose: 'Assist with CRM contact lookup, duplicate detection, and task proposals.',
    allowedTools: ['search_contacts', 'get_customer_360', 'create_task', 'update_contact'],
    requiredRole: 'member',
    maxSteps: 6,
    approvalPolicy: 'medium_risk_gated'
  },
  workflow_designer: {
    type: 'workflow_designer',
    purpose: 'Design and validate workflow drafts without publishing production flows.',
    allowedTools: ['list_workflows', 'validate_workflow_draft'],
    requiredRole: 'member',
    maxSteps: 5,
    approvalPolicy: 'never_publish_unapproved'
  },
  customer_support: {
    type: 'customer_support',
    purpose: 'Draft grounded support responses using approved knowledge sources.',
    allowedTools: ['search_knowledge', 'draft_reply'],
    requiredRole: 'member',
    maxSteps: 5,
    approvalPolicy: 'external_requires_approval'
  },
  marketing_assistant: {
    type: 'marketing_assistant',
    purpose: 'Draft campaign copy and segment suggestions.',
    allowedTools: ['search_knowledge', 'list_smart_lists'],
    requiredRole: 'member',
    maxSteps: 5,
    approvalPolicy: 'external_requires_approval'
  },
  data_analysis: {
    type: 'data_analysis',
    purpose: 'Analyze authorized CRM and pipeline summaries.',
    allowedTools: ['get_pipeline_summary', 'get_reporting_summary'],
    requiredRole: 'viewer',
    maxSteps: 5,
    approvalPolicy: 'read_only'
  },
  integration_assistant: {
    type: 'integration_assistant',
    purpose: 'Inspect connector readiness, webhook events, and sync conflicts.',
    allowedTools: ['list_connectors', 'get_integration_metrics'],
    requiredRole: 'member',
    maxSteps: 5,
    approvalPolicy: 'read_only'
  },
  reporting_assistant: {
    type: 'reporting_assistant',
    purpose: 'Compile factual metrics from actual workspace data.',
    allowedTools: ['get_reporting_summary', 'get_workflow_metrics'],
    requiredRole: 'viewer',
    maxSteps: 5,
    approvalPolicy: 'read_only'
  },
  knowledge_assistant: {
    type: 'knowledge_assistant',
    purpose: 'Answer questions strictly from verified workspace documents with citations.',
    allowedTools: ['search_knowledge'],
    requiredRole: 'viewer',
    maxSteps: 4,
    approvalPolicy: 'read_only'
  },
  operations_assistant: {
    type: 'operations_assistant',
    purpose: 'Coordinate multi-step operational reviews and approval proposals.',
    allowedTools: ['search_contacts', 'create_task', 'get_workflow_metrics'],
    requiredRole: 'member',
    maxSteps: 6,
    approvalPolicy: 'high_risk_requires_approval'
  }
});

export function validateAgentPlan(plan = {}, { allowedTools = [], maxSteps = MAX_PLAN_STEPS } = {}) {
  const errors = [];
  if (!plan || typeof plan !== 'object') {
    return { valid: false, errors: [{ code: 'INVALID_PLAN', message: 'Plan must be an object' }] };
  }
  if (typeof plan.objective !== 'string' || !plan.objective.trim()) {
    errors.push({ code: 'MISSING_OBJECTIVE', message: 'Plan requires a non-empty objective' });
  }
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  if (steps.length === 0) {
    errors.push({ code: 'EMPTY_PLAN_STEPS', message: 'Plan must include at least one step' });
  }
  if (steps.length > Math.min(MAX_PLAN_STEPS, maxSteps)) {
    errors.push({ code: 'PLAN_TOO_LONG', message: `Plan exceeds maxSteps (${steps.length} > ${maxSteps})` });
  }
  const allowedSet = new Set(allowedTools);
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step || typeof step.action !== 'string') {
      errors.push({ code: 'INVALID_STEP', stepIndex: i, message: 'Step requires action name' });
      continue;
    }
    if (step.tool && allowedTools.length > 0 && !allowedSet.has(step.tool)) {
      errors.push({ code: 'UNAUTHORIZED_PLAN_TOOL', stepIndex: i, tool: step.tool, message: `Tool "${step.tool}" not authorized for this agent` });
    }
  }
  return { valid: errors.length === 0, errors };
}

export function createMultiAgentOrchestrator({ executeSpecialist }) {
  async function delegateTask({
    parentRunId = randomUUID(),
    parentAllowedTools = [],
    tenantContext = {},
    specialistType,
    objective,
    depth = 1,
    timeoutMs = 15_000
  } = {}) {
    if (!tenantContext?.agencyId || !tenantContext?.locationId) {
      throw Object.assign(new Error('Tenant context required for delegation'), { code: 'TENANT_CONTEXT_REQUIRED' });
    }
    if (depth > MAX_DELEGATION_DEPTH) {
      return {
        ok: false,
        code: 'MAX_DELEGATION_DEPTH_EXCEEDED',
        message: `Delegation depth ${depth} exceeds limit (${MAX_DELEGATION_DEPTH})`
      };
    }
    const spec = SPECIALIZED_AGENTS[specialistType];
    if (!spec) {
      return { ok: false, code: 'UNKNOWN_SPECIALIST', message: `Unknown specialist: ${specialistType}` };
    }

    // Strict permission intersection: child NEVER gains tools the parent did not possess
    const parentSet = new Set(parentAllowedTools);
    const effectiveTools = parentAllowedTools.length > 0
      ? spec.allowedTools.filter(t => parentSet.has(t))
      : [...spec.allowedTools];

    const planCheck = validateAgentPlan(
      { objective, steps: [{ action: 'execute_specialist', tool: effectiveTools[0] || undefined }] },
      { allowedTools: effectiveTools, maxSteps: spec.maxSteps }
    );
    if (!planCheck.valid) {
      return { ok: false, code: 'INVALID_DELEGATION_PLAN', errors: planCheck.errors };
    }

    const result = await Promise.race([
      executeSpecialist({
        delegationId: randomUUID(),
        parentRunId,
        specialistType,
        objective,
        effectiveTools,
        tenantContext,
        depth
      }),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Delegation timed out'), { code: 'DELEGATION_TIMEOUT' })), timeoutMs))
    ]);

    return {
      ok: true,
      specialistType,
      depth,
      effectiveTools,
      result
    };
  }

  return { delegateTask, listSpecialists: () => Object.values(SPECIALIZED_AGENTS) };
}
