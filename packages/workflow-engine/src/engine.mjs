import { createHash, randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Utility — Checksum
// ---------------------------------------------------------------------------

export function calculateChecksum(state) {
  return createHash('sha256').update(JSON.stringify(state || {})).digest('hex');
}

// ---------------------------------------------------------------------------
// Template Engine — replaces {{path.to.value}} with context data
// ---------------------------------------------------------------------------

/**
 * Resolve a dotted path ("contact.firstName") from a nested object.
 * Returns undefined when any segment is missing.
 */
function resolvePath(obj, path) {
  return path.split('.').reduce((cur, key) => cur?.[key], obj);
}

/**
 * Replace every `{{expr}}` in `template` with the corresponding value
 * looked up in `context`.  Unknown placeholders are left blank.
 */
export function renderTemplate(template, context) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{([\w.]+)\}\}/g, (_match, path) => {
    const val = resolvePath(context, path.trim());
    return val !== undefined && val !== null ? String(val) : '';
  });
}

// ---------------------------------------------------------------------------
// Condition evaluator
// ---------------------------------------------------------------------------

export function evaluateCondition(rule, context) {
  const { field, operator, value } = rule;
  const target = resolvePath(context, field) ?? '';
  switch (operator) {
    case 'equals':
      return String(target).toLowerCase() === String(value).toLowerCase();
    case 'not_equals':
      return String(target).toLowerCase() !== String(value).toLowerCase();
    case 'contains':
      return String(target).toLowerCase().includes(String(value).toLowerCase());
    case 'greater_than':
      return Number(target) > Number(value);
    case 'less_than':
      return Number(target) < Number(value);
    case 'gte':
      return Number(target) >= Number(value);
    case 'lte':
      return Number(target) <= Number(value);
    case 'is_empty':
      return !target || target === '';
    case 'is_not_empty':
      return !!target && target !== '';
    case 'in':
      return Array.isArray(value) ? value.map(v => String(v).toLowerCase()).includes(String(target).toLowerCase()) : false;
    case 'not_in':
      return Array.isArray(value) ? !value.map(v => String(v).toLowerCase()).includes(String(target).toLowerCase()) : true;
    case 'regex':
      try { return new RegExp(value, 'i').test(String(target)); } catch { return false; }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Retry Logic — exponential back-off helper
// ---------------------------------------------------------------------------

const DEFAULT_RETRY_OPTIONS = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitter: true,
};

/**
 * Execute `fn` with exponential back-off retries.
 * Returns the first successful result or throws after all attempts fail.
 */
export async function withRetry(fn, opts = {}) {
  const { maxAttempts, baseDelayMs, maxDelayMs, jitter } = { ...DEFAULT_RETRY_OPTIONS, ...opts };

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      const expDelay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delay = jitter ? expDelay * (0.5 + Math.random() * 0.5) : expDelay;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Step executor — all node types
// ---------------------------------------------------------------------------

export async function executeStep({
  node,
  execution,
  triggerContext,
  crmActions,
  aiHandler,
  now = Date.now(),
  variables = {},
}) {
  const { id: nodeId, type, config = {} } = node;

  // Human-approval gate (unchanged)
  if (node.requiresApproval && !execution.approvedBy) {
    return {
      status: 'waiting_approval',
      nodeId,
      result: { message: 'Awaiting human operator approval' },
    };
  }

  // Build a combined context available to templates
  const ctx = { ...triggerContext, variables };

  try {
    switch (type) {
      // ---------------------------------------------------------------
      // Original node types
      // ---------------------------------------------------------------
      case 'email':
      case 'send_email': {
        const to = renderTemplate(config.to, ctx) || triggerContext.contact?.email;
        const subject = renderTemplate(config.subject, ctx) || 'Automated Update';
        const body = renderTemplate(config.body, ctx) || '';
        await crmActions.sendEmail({ to, subject, body });
        return { status: 'completed', nodeId, result: { sentTo: to } };
      }

      case 'sms':
      case 'send_sms': {
        const to = renderTemplate(config.phone, ctx) || triggerContext.contact?.phone;
        const message = renderTemplate(config.message, ctx) || '';
        await crmActions.sendSms({ to, message });
        return { status: 'completed', nodeId, result: { sentTo: to } };
      }

      case 'tag':
      case 'add_tag': {
        const tag = renderTemplate(config.tag, ctx);
        const contactId = triggerContext.contact?.id;
        if (contactId && tag) {
          await crmActions.addContactTag({ contactId, tag });
        }
        return { status: 'completed', nodeId, result: { tagAdded: tag } };
      }

      case 'task':
      case 'create_task': {
        const title = renderTemplate(config.title, ctx) || 'Follow up task';
        const contactId = triggerContext.contact?.id;
        await crmActions.createTask({
          title,
          contactId,
          dueDate: config.dueDate || new Date(now + 86400000).toISOString(),
          priority: config.priority || 'medium',
        });
        return { status: 'completed', nodeId, result: { taskCreated: title } };
      }

      case 'opportunity_stage':
      case 'update_stage': {
        const opportunityId = triggerContext.opportunity?.id;
        const stage = renderTemplate(config.stage, ctx);
        if (opportunityId && stage) {
          await crmActions.updateOpportunityStage({ opportunityId, stage });
        }
        return { status: 'completed', nodeId, result: { stageUpdated: stage } };
      }

      case 'condition':
      case 'if_else': {
        const rules = config.rules || [];
        const data = triggerContext.contact || triggerContext;
        const isMatch = rules.every(rule => evaluateCondition(rule, data));
        const selectedBranch = isMatch ? 'true' : 'false';
        return {
          status: 'completed',
          nodeId,
          selectedBranch,
          result: { branch: selectedBranch, isMatch },
        };
      }

      case 'webhook': {
        const url = renderTemplate(config.url, ctx);
        const method = config.method || 'POST';
        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
          body: method !== 'GET' ? JSON.stringify({ triggerContext, executionId: execution.id }) : undefined,
        });
        return { status: 'completed', nodeId, result: { httpStatus: response.status } };
      }

      case 'ai_agent':
      case 'copilot': {
        if (!aiHandler) throw new Error('AI Handler not configured');
        const prompt = renderTemplate(config.prompt, ctx) || 'Analyze lead and generate response';
        const aiResponse = await aiHandler({ prompt, context: triggerContext });
        return { status: 'completed', nodeId, result: { aiResponse } };
      }

      case 'wait': {
        const durationMinutes = Number(config.durationMinutes) || 5;
        const retryAt = new Date(now + durationMinutes * 60 * 1000).toISOString();
        return { status: 'waiting', nodeId, retryAt, result: { retryAt } };
      }

      // ---------------------------------------------------------------
      // NEW — http_request
      // ---------------------------------------------------------------
      case 'http_request': {
        const url = renderTemplate(config.url, ctx);
        const method = (config.method || 'GET').toUpperCase();
        const headers = { 'Content-Type': 'application/json' };
        if (config.headers) {
          for (const [k, v] of Object.entries(config.headers)) {
            headers[k] = renderTemplate(v, ctx);
          }
        }
        const bodyPayload = method !== 'GET' && config.body
          ? renderTemplate(typeof config.body === 'string' ? config.body : JSON.stringify(config.body), ctx)
          : undefined;

        const res = await fetch(url, { method, headers, body: bodyPayload });
        const contentType = res.headers?.get?.('content-type') || '';
        let parsed;
        if (contentType.includes('application/json')) {
          try { parsed = await res.json(); } catch { parsed = null; }
        } else {
          parsed = await res.text();
        }
        return {
          status: 'completed',
          nodeId,
          result: { httpStatus: res.status, response: parsed },
        };
      }

      // ---------------------------------------------------------------
      // NEW — delay  (minutes / hours / days)
      // ---------------------------------------------------------------
      case 'delay': {
        const unit = config.unit || 'minutes';
        const amount = Number(config.amount) || 1;
        const multiplier = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
        const ms = amount * (multiplier[unit] || multiplier.minutes);
        const retryAt = new Date(now + ms).toISOString();
        return { status: 'waiting', nodeId, retryAt, result: { retryAt, delayAmount: amount, delayUnit: unit } };
      }

      // ---------------------------------------------------------------
      // NEW — split_test  (A/B traffic split)
      // ---------------------------------------------------------------
      case 'split_test': {
        const pct = Number(config.percentageA) || 50;
        const roll = Math.random() * 100;
        const selectedBranch = roll < pct ? 'A' : 'B';
        return {
          status: 'completed',
          nodeId,
          selectedBranch,
          result: { branch: selectedBranch, roll: Math.round(roll * 100) / 100, percentageA: pct },
        };
      }

      // ---------------------------------------------------------------
      // NEW — loop  (iterate over an array in context)
      // ---------------------------------------------------------------
      case 'loop': {
        const arrayPath = config.arrayPath; // e.g. "contact.tags"
        const items = resolvePath(ctx, arrayPath);
        if (!Array.isArray(items)) {
          return { status: 'completed', nodeId, result: { notice: 'arrayPath did not resolve to an array', iterations: 0 } };
        }
        // The graph walker handles child execution — here we just mark the items
        return {
          status: 'completed',
          nodeId,
          loopItems: items,
          result: { iterations: items.length },
        };
      }

      // ---------------------------------------------------------------
      // NEW — set_variable
      // ---------------------------------------------------------------
      case 'set_variable': {
        const varName = config.name;
        let varValue;
        if (config.expression) {
          // Simple expression: pull from context
          varValue = resolvePath(ctx, config.expression);
        } else {
          varValue = renderTemplate(config.value, ctx);
        }
        return {
          status: 'completed',
          nodeId,
          setVariable: { name: varName, value: varValue },
          result: { variableSet: varName, value: varValue },
        };
      }

      // ---------------------------------------------------------------
      // NEW — math
      // ---------------------------------------------------------------
      case 'math': {
        const a = Number(resolvePath(ctx, config.operandA) ?? config.operandA);
        const b = Number(resolvePath(ctx, config.operandB) ?? config.operandB);
        const op = config.operation || 'add';
        let mathResult;
        switch (op) {
          case 'add': mathResult = a + b; break;
          case 'subtract': mathResult = a - b; break;
          case 'multiply': mathResult = a * b; break;
          case 'divide': mathResult = b !== 0 ? a / b : null; break;
          case 'modulo': mathResult = b !== 0 ? a % b : null; break;
          case 'round': mathResult = Math.round(a); break;
          case 'floor': mathResult = Math.floor(a); break;
          case 'ceil': mathResult = Math.ceil(a); break;
          default: mathResult = null;
        }
        const setVar = config.resultVariable ? { name: config.resultVariable, value: mathResult } : undefined;
        return {
          status: 'completed',
          nodeId,
          ...(setVar ? { setVariable: setVar } : {}),
          result: { mathResult, operation: op },
        };
      }

      // ---------------------------------------------------------------
      // NEW — filter  (filter / transform arrays)
      // ---------------------------------------------------------------
      case 'filter': {
        const arrayPath = config.arrayPath;
        const items = resolvePath(ctx, arrayPath);
        if (!Array.isArray(items)) {
          return { status: 'completed', nodeId, result: { notice: 'arrayPath did not resolve to an array', filteredCount: 0 } };
        }
        const filterRules = config.rules || [];
        const filtered = items.filter(item =>
          filterRules.every(rule => evaluateCondition(rule, typeof item === 'object' ? item : { value: item }))
        );
        // Optionally pick fields
        const pick = config.pick; // array of field names
        const output = pick && Array.isArray(pick)
          ? filtered.map(item => pick.reduce((acc, f) => ({ ...acc, [f]: item?.[f] }), {}))
          : filtered;
        const setVar = config.resultVariable ? { name: config.resultVariable, value: output } : undefined;
        return {
          status: 'completed',
          nodeId,
          ...(setVar ? { setVariable: setVar } : {}),
          result: { filteredCount: output.length, data: output },
        };
      }

      // ---------------------------------------------------------------
      // NEW — slack_notify
      // ---------------------------------------------------------------
      case 'slack_notify': {
        const webhookUrl = renderTemplate(config.webhookUrl, ctx);
        const text = renderTemplate(config.message || config.text, ctx);
        const channel = config.channel ? renderTemplate(config.channel, ctx) : undefined;
        const payload = { text };
        if (channel) payload.channel = channel;
        if (config.username) payload.username = config.username;
        if (config.icon_emoji) payload.icon_emoji = config.icon_emoji;

        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return { status: 'completed', nodeId, result: { httpStatus: res.status, slackText: text } };
      }

      // ---------------------------------------------------------------
      // NEW — update_contact
      // ---------------------------------------------------------------
      case 'update_contact': {
        const contactId = triggerContext.contact?.id;
        if (!contactId) {
          return { status: 'completed', nodeId, result: { notice: 'No contact in trigger context' } };
        }
        const fields = {};
        for (const [k, v] of Object.entries(config.fields || {})) {
          fields[k] = renderTemplate(v, ctx);
        }
        await crmActions.updateContact({ contactId, fields });
        return { status: 'completed', nodeId, result: { contactUpdated: contactId, fields } };
      }

      // ---------------------------------------------------------------
      // NEW — create_opportunity
      // ---------------------------------------------------------------
      case 'create_opportunity': {
        const contactId = triggerContext.contact?.id;
        const name = renderTemplate(config.name || config.title, ctx) || 'New Opportunity';
        const value = Number(config.value) || 0;
        const stage = renderTemplate(config.stage, ctx) || 'new';
        const pipelineId = config.pipelineId;
        const result = await crmActions.createOpportunity({ contactId, name, value, stage, pipelineId });
        return { status: 'completed', nodeId, result: { opportunityCreated: result?.id || true, name, value, stage } };
      }

      // ---------------------------------------------------------------
      // NEW — assign_to  (assign contact/task to team member)
      // ---------------------------------------------------------------
      case 'assign_to': {
        const contactId = triggerContext.contact?.id;
        let assigneeId = config.userId;
        if (config.roundRobin && Array.isArray(config.teamMembers) && config.teamMembers.length > 0) {
          // Simple round-robin based on execution id hash
          const hash = createHash('md5').update(execution.id || randomUUID()).digest();
          const idx = hash.readUInt32BE(0) % config.teamMembers.length;
          assigneeId = config.teamMembers[idx];
        }
        if (!assigneeId) {
          return { status: 'completed', nodeId, result: { notice: 'No assignee could be determined' } };
        }
        await crmActions.assignContact({ contactId, userId: assigneeId });
        return { status: 'completed', nodeId, result: { assignedTo: assigneeId, contactId } };
      }

      // ---------------------------------------------------------------
      // NEW — send_review_request
      // ---------------------------------------------------------------
      case 'send_review_request': {
        const contactId = triggerContext.contact?.id;
        const platform = config.platform || 'google'; // google, facebook, yelp, etc.
        const reviewUrl = renderTemplate(config.reviewUrl, ctx);
        const message = renderTemplate(config.message, ctx) || 'We would love your feedback!';
        const channel = config.channel || 'sms'; // sms or email
        await crmActions.sendReviewRequest({ contactId, platform, reviewUrl, message, channel });
        return { status: 'completed', nodeId, result: { reviewRequestSent: true, platform, channel } };
      }

      // ---------------------------------------------------------------
      // Default — no-op
      // ---------------------------------------------------------------
      default:
        return { status: 'completed', nodeId, result: { notice: 'No-op step' } };
    }
  } catch (error) {
    return {
      status: 'failed',
      nodeId,
      error: error.message || 'Execution failed',
    };
  }
}

// ---------------------------------------------------------------------------
// Graph Walker — traverse a directed graph of nodes
// ---------------------------------------------------------------------------

/**
 * Build an adjacency map from a flat array of nodes.
 * Each node should have:
 *   - id (string)
 *   - type (string)
 *   - config (object)
 *   - next (string | null)          — default next node id
 *   - branches (object | null)      — { "true": nodeId, "false": nodeId } for conditions
 *                                      { "A": nodeId, "B": nodeId } for split_test
 *   - children (string[] | null)    — child node ids for loop
 */
function buildNodeMap(nodes) {
  const map = new Map();
  for (const node of nodes) {
    map.set(node.id, node);
  }
  return map;
}

/**
 * Walk a directed graph of workflow nodes, executing each one in order.
 *
 * @param {Array}    nodes           – flat array of node definitions
 * @param {object}   triggerContext   – data that started the workflow
 * @param {Function} stepExecutor    – async (node, context, variables) => stepResult
 *                                     Defaults to `executeStep` with the given deps.
 * @param {object}   [deps]          – { execution, crmActions, aiHandler }
 * @returns {Promise<{ timeline: object[], variables: object, finalStatus: string }>}
 */
export async function walkGraph(nodes, triggerContext, stepExecutor, deps = {}) {
  const nodeMap = buildNodeMap(nodes);
  const timeline = [];
  const variables = {};
  const visited = new Set();

  // Find the entry node — either marked entrypoint, or first in list
  let entryId = nodes.find(n => n.entrypoint)?.id || nodes[0]?.id;
  if (!entryId) return { timeline, variables, finalStatus: 'completed' };

  // Queue: supports parallel paths
  const queue = [entryId];
  let finalStatus = 'completed';

  while (queue.length > 0) {
    const currentId = queue.shift();

    // Guard: skip already-visited (prevents infinite loops)
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const node = nodeMap.get(currentId);
    if (!node) continue;

    const startedAt = Date.now();

    // Execute the step
    let stepResult;
    if (stepExecutor) {
      stepResult = await stepExecutor(node, triggerContext, variables);
    } else {
      stepResult = await executeStep({
        node,
        execution: deps.execution || {},
        triggerContext,
        crmActions: deps.crmActions,
        aiHandler: deps.aiHandler,
        now: startedAt,
        variables,
      });
    }

    const finishedAt = Date.now();

    // Record timeline entry
    timeline.push({
      nodeId: node.id,
      nodeName: node.name || node.id,
      nodeType: node.type,
      status: stepResult.status,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      attempt: 1,
      result: stepResult.result || null,
      error: stepResult.error || null,
    });

    // If the step set a variable, record it
    if (stepResult.setVariable) {
      variables[stepResult.setVariable.name] = stepResult.setVariable.value;
    }

    // Handle waiting / failed statuses
    if (stepResult.status === 'waiting' || stepResult.status === 'waiting_approval') {
      finalStatus = stepResult.status;
      // Do not continue graph — the scheduler will resume later
      continue;
    }
    if (stepResult.status === 'failed') {
      finalStatus = 'failed';
      // Stop this path on failure (other parallel paths may continue)
      continue;
    }

    // Handle loop — execute children for each item
    if (stepResult.loopItems && node.children?.length) {
      for (let idx = 0; idx < stepResult.loopItems.length; idx++) {
        const itemCtx = {
          ...triggerContext,
          loopItem: stepResult.loopItems[idx],
          loopIndex: idx,
        };
        for (const childId of node.children) {
          const childNode = nodeMap.get(childId);
          if (!childNode) continue;
          const childStart = Date.now();
          let childResult;
          if (stepExecutor) {
            childResult = await stepExecutor(childNode, itemCtx, variables);
          } else {
            childResult = await executeStep({
              node: childNode,
              execution: deps.execution || {},
              triggerContext: itemCtx,
              crmActions: deps.crmActions,
              aiHandler: deps.aiHandler,
              now: childStart,
              variables,
            });
          }
          const childEnd = Date.now();
          timeline.push({
            nodeId: childNode.id,
            nodeName: childNode.name || childNode.id,
            nodeType: childNode.type,
            status: childResult.status,
            startedAt: new Date(childStart).toISOString(),
            finishedAt: new Date(childEnd).toISOString(),
            durationMs: childEnd - childStart,
            attempt: 1,
            result: childResult.result || null,
            error: childResult.error || null,
          });
          if (childResult.setVariable) {
            variables[childResult.setVariable.name] = childResult.setVariable.value;
          }
        }
      }
    }

    // Determine next node(s) to visit
    if (stepResult.selectedBranch && node.branches) {
      const branchTarget = node.branches[stepResult.selectedBranch];
      if (branchTarget) queue.push(branchTarget);
      // Also enqueue parallel branches if configured
      if (node.parallelBranches) {
        for (const pid of Object.values(node.branches)) {
          if (pid && pid !== branchTarget && !visited.has(pid)) queue.push(pid);
        }
      }
    } else if (node.next) {
      // node.next can be a string or an array (for parallel paths)
      if (Array.isArray(node.next)) {
        for (const nid of node.next) queue.push(nid);
      } else {
        queue.push(node.next);
      }
    }
  }

  return { timeline, variables, finalStatus };
}

// ---------------------------------------------------------------------------
// Execution Timeline Builder
// ---------------------------------------------------------------------------

/**
 * Build a structured timeline from an execution record that contains step logs.
 *
 * @param {object} execution - An execution record with `steps` array.
 *   Each step: { id, nodeId, nodeName?, nodeType?, status, details?, errorCode?, startedAt, finishedAt, attempt? }
 * @returns {Array<{ nodeId, nodeName, nodeType, status, startedAt, finishedAt, durationMs, attempt, result, error }>}
 */
export function buildExecutionTimeline(execution) {
  if (!execution) return [];

  // Steps may come from the walkGraph timeline or from persisted execution_steps rows.
  const rawSteps = execution.timeline || execution.steps || [];

  return rawSteps.map(step => {
    const startedAt = step.startedAt ? new Date(step.startedAt) : null;
    const finishedAt = step.finishedAt ? new Date(step.finishedAt) : null;
    const durationMs = startedAt && finishedAt ? finishedAt.getTime() - startedAt.getTime() : step.durationMs ?? null;

    return {
      nodeId: step.nodeId || step.node_id || null,
      nodeName: step.nodeName || step.node_name || step.nodeId || step.node_id || null,
      nodeType: step.nodeType || step.node_type || null,
      status: step.status,
      startedAt: startedAt ? startedAt.toISOString() : null,
      finishedAt: finishedAt ? finishedAt.toISOString() : null,
      durationMs,
      attempt: step.attempt ?? 1,
      result: step.result || step.details || null,
      error: step.error || step.errorCode || step.error_code || null,
    };
  });
}
