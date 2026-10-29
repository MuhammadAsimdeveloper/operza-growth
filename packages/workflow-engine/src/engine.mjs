import { createHash, randomUUID } from 'node:crypto';

export function calculateChecksum(state) {
  return createHash('sha256').update(JSON.stringify(state || {})).digest('hex');
}

export function evaluateCondition(rule, context) {
  const { field, operator, value } = rule;
  const target = context?.[field] ?? '';
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
    case 'is_empty':
      return !target || target === '';
    case 'is_not_empty':
      return !!target && target !== '';
    default:
      return false;
  }
}

export async function executeStep({
  node,
  execution,
  triggerContext,
  crmActions,
  aiHandler,
  now = Date.now()
}) {
  const { id: nodeId, type, config = {} } = node;
  
  if (node.requiresApproval && !execution.approvedBy) {
    return {
      status: 'waiting_approval',
      nodeId,
      result: { message: 'Awaiting human operator approval' }
    };
  }

  try {
    switch (type) {
      case 'email':
      case 'send_email': {
        const to = config.to || triggerContext.contact?.email;
        const subject = config.subject || 'Automated Update';
        const body = config.body || '';
        await crmActions.sendEmail({ to, subject, body });
        return { status: 'completed', nodeId, result: { sentTo: to } };
      }

      case 'sms':
      case 'send_sms': {
        const to = config.phone || triggerContext.contact?.phone;
        const message = config.message || '';
        await crmActions.sendSms({ to, message });
        return { status: 'completed', nodeId, result: { sentTo: to } };
      }

      case 'tag':
      case 'add_tag': {
        const tag = config.tag;
        const contactId = triggerContext.contact?.id;
        if (contactId && tag) {
          await crmActions.addContactTag({ contactId, tag });
        }
        return { status: 'completed', nodeId, result: { tagAdded: tag } };
      }

      case 'task':
      case 'create_task': {
        const title = config.title || 'Follow up task';
        const contactId = triggerContext.contact?.id;
        await crmActions.createTask({
          title,
          contactId,
          dueDate: config.dueDate || new Date(now + 86400000).toISOString(),
          priority: config.priority || 'medium'
        });
        return { status: 'completed', nodeId, result: { taskCreated: title } };
      }

      case 'opportunity_stage':
      case 'update_stage': {
        const opportunityId = triggerContext.opportunity?.id;
        const stage = config.stage;
        if (opportunityId && stage) {
          await crmActions.updateOpportunityStage({ opportunityId, stage });
        }
        return { status: 'completed', nodeId, result: { stageUpdated: stage } };
      }

      case 'condition':
      case 'if_else': {
        const rules = config.rules || [];
        const isMatch = rules.every(rule => evaluateCondition(rule, triggerContext.contact || triggerContext));
        const selectedBranch = isMatch ? 'true' : 'false';
        return {
          status: 'completed',
          nodeId,
          selectedBranch,
          result: { branch: selectedBranch, isMatch }
        };
      }

      case 'webhook': {
        const url = config.url;
        const method = config.method || 'POST';
        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
          body: method !== 'GET' ? JSON.stringify({ triggerContext, executionId: execution.id }) : undefined
        });
        return { status: 'completed', nodeId, result: { httpStatus: response.status } };
      }

      case 'ai_agent':
      case 'copilot': {
        if (!aiHandler) throw new Error('AI Handler not configured');
        const prompt = config.prompt || 'Analyze lead and generate response';
        const aiResponse = await aiHandler({ prompt, context: triggerContext });
        return { status: 'completed', nodeId, result: { aiResponse } };
      }

      case 'wait': {
        const durationMinutes = Number(config.durationMinutes) || 5;
        const retryAt = new Date(now + durationMinutes * 60 * 1000).toISOString();
        return { status: 'waiting', nodeId, retryAt, result: { retryAt } };
      }

      default:
        return { status: 'completed', nodeId, result: { notice: 'No-op step' } };
    }
  } catch (error) {
    return {
      status: 'failed',
      nodeId,
      error: error.message || 'Execution failed'
    };
  }
}
