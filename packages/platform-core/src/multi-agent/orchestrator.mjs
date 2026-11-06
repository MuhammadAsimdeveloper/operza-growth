/**
 * ============================================================================
 * Operza Multi-Agent Orchestration Engine
 * ============================================================================
 * 
 * Coordinates specialized AI agents, manages autonomous handoffs, tracks
 * conversational memory, and guarantees fail-closed governance for write actions.
 */

import { randomUUID } from 'node:crypto';
import { AGENT_ROLES, getAgent } from './agents.mjs';

const MAX_AGENT_HOPS = 5;

export class MultiAgentOrchestrator {
  /**
   * @param {object} options
   * @param {import('../llm-runtime/runtime-engine.mjs').LLMRuntimeEngine} options.llmRuntime
   * @param {object} [options.toolExecutor] Map of tool execution functions
   * @param {Function} [options.proposalStore] Callback to store write proposals
   */
  constructor(options = {}) {
    if (!options.llmRuntime) {
      throw new Error('LLMRuntimeEngine is required for MultiAgentOrchestrator');
    }
    this.llmRuntime = options.llmRuntime;
    this.toolExecutor = options.toolExecutor || {};
    this.proposalStore = options.proposalStore || (async () => ({ id: `prop_${randomUUID().slice(0, 8)}`, status: 'pending_review' }));
  }

  /**
   * Runs multi-agent processing for a user turn with streaming event delivery.
   * @param {object} params
   * @param {string} params.message User message
   * @param {string} [params.sessionId] Session identifier
   * @param {string} [params.startAgent] Starting agent (defaults to 'supervisor')
   * @param {object} [params.context] Tenant and workspace context
   * @param {object} [params.actor] Acting user/membership
   * @returns {AsyncGenerator<object, void, unknown>}
   */
  async *processUserMessageStream({ message, sessionId = randomUUID(), startAgent = AGENT_ROLES.SUPERVISOR, context = {}, actor = {} }) {
    let currentAgentId = startAgent;
    let hops = 0;
    const executionChain = [];

    yield { type: 'session', sessionId, activeAgent: currentAgentId };

    while (hops < MAX_AGENT_HOPS) {
      hops += 1;
      const agent = getAgent(currentAgentId) || getAgent(AGENT_ROLES.SUPERVISOR);
      executionChain.push(agent.id);

      // Determine if a handoff is required based on user message and current agent
      let targetHandoff = null;
      const lower = message.toLowerCase();

      if (agent.id === AGENT_ROLES.SUPERVISOR) {
        if (lower.includes('workflow') || lower.includes('zapier') || lower.includes('automation') || lower.includes('webhook') || lower.includes('trigger')) {
          targetHandoff = { targetAgent: AGENT_ROLES.AUTOMATION, reason: 'Automation, workflow, or Zapier inquiry detected' };
        } else if (lower.includes('contact') || lower.includes('deal') || lower.includes('pipeline') || lower.includes('opportunity') || lower.includes('lead') || lower.includes('appointment')) {
          targetHandoff = { targetAgent: AGENT_ROLES.CRM, reason: 'CRM, pipeline, or contact inquiry detected' };
        } else if (lower.includes('support') || lower.includes('help') || lower.includes('hours') || lower.includes('faq') || lower.includes('how do i')) {
          targetHandoff = { targetAgent: AGENT_ROLES.SUPPORT, reason: 'Customer support or knowledge base inquiry detected' };
        }
      }

      if (targetHandoff && targetHandoff.targetAgent !== currentAgentId) {
        yield {
          type: 'agent_handoff',
          from: currentAgentId,
          to: targetHandoff.targetAgent,
          reason: targetHandoff.reason
        };
        currentAgentId = targetHandoff.targetAgent;
        continue;
      }

      // Check for domain tool calls based on agent competence
      if (agent.id === AGENT_ROLES.CRM) {
        if (lower.includes('search') || lower.includes('find') || lower.includes('look up')) {
          const queryMatch = message.match(/(?:search|find|look up)\s+(?:contacts?\s+)?(?:for\s+)?["']?(.+?)["']?\s*$/i);
          const query = queryMatch ? queryMatch[1] : message;
          yield { type: 'tool_executing', tool: 'search_contacts', params: { query } };

          let readResult = { results: [] };
          if (typeof this.toolExecutor.search_contacts === 'function') {
            readResult = await this.toolExecutor.search_contacts({ query }, actor, context);
          }
          yield { type: 'tool_completed', tool: 'search_contacts', result: readResult };
        } else if (lower.includes('create contact') || lower.includes('add lead') || lower.includes('new contact')) {
          const emailMatch = message.match(/[\w.-]+@[\w.-]+\.\w+/);
          const nameMatch = message.match(/(?:contact|lead|named)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
          const toolParams = {
            name: nameMatch ? nameMatch[1].trim() : 'Inbound Lead',
            email: emailMatch ? emailMatch[0] : 'lead@enterprise.test',
            tags: ['copilot-lead']
          };
          yield { type: 'tool_executing', tool: 'create_contact', params: toolParams };

          const proposal = await this.proposalStore('create_contact', toolParams, actor, context);
          yield {
            type: 'proposal_created',
            proposalId: proposal.id,
            toolName: 'create_contact',
            status: proposal.status || 'pending_review',
            params: toolParams
          };
        }
      } else if (agent.id === AGENT_ROLES.AUTOMATION) {
        if (lower.includes('generate workflow') || lower.includes('build workflow') || lower.includes('create workflow') || lower.includes('build automation') || lower.includes('generate automation')) {
          const nameMatch = message.match(/(?:workflow|automation)(?:\s+(?:named|called|for))?\s+["']?([^"'\n]+?)["']?$/i);
          const wfName = nameMatch ? nameMatch[1].trim() : 'AI Generated Growth Workflow';

          const generatedNodes = [
            {
              id: 'node-trigger-inbound',
              name: 'Inbound Lead Trigger',
              type: 'tag',
              config: { tag: 'inbound-prospect' }
            },
            {
              id: 'node-ai-classify',
              name: 'Cognitive Intent Classifier',
              type: 'ai_classify',
              config: {
                text: '{{contact.notes}}',
                categories: ['enterprise_sales', 'standard_support', 'general_inquiry'],
                resultVariable: 'lead_intent'
              }
            },
            {
              id: 'node-approval-gate',
              name: 'Executive Human Approval Gate',
              type: 'condition',
              requiresApproval: true,
              config: { message: 'Verify enterprise lead qualification before outbound transmission' }
            },
            {
              id: 'node-zapier-notify',
              name: 'Zapier Slack Notification',
              type: 'zapier',
              config: {
                hookUrl: 'https://hooks.zapier.com/hooks/catch/999999/alpha/',
                payload: { event: 'lead_qualified', contactEmail: '{{contact.email}}' }
              }
            }
          ];

          const toolParams = {
            name: wfName,
            status: 'draft',
            triggerType: 'tag',
            triggerConfig: { tag: 'inbound-prospect' },
            nodes: generatedNodes
          };

          yield { type: 'tool_executing', tool: 'generate_workflow', params: toolParams };

          const proposal = await this.proposalStore('generate_workflow', toolParams, actor, context);
          yield {
            type: 'proposal_created',
            proposalId: proposal.id,
            toolName: 'generate_workflow',
            status: proposal.status || 'pending_review',
            params: toolParams
          };
        } else if (lower.includes('trigger workflow') || lower.includes('run workflow')) {
          const wfMatch = message.match(/(?:workflow)\s+["']?([^"'\n]+?)["']?$/i);
          const toolParams = { workflowName: wfMatch ? wfMatch[1].trim() : 'Lead Triage' };
          yield { type: 'tool_executing', tool: 'trigger_workflow', params: toolParams };

          const proposal = await this.proposalStore('trigger_workflow', toolParams, actor, context);
          yield {
            type: 'proposal_created',
            proposalId: proposal.id,
            toolName: 'trigger_workflow',
            status: proposal.status || 'pending_review',
            params: toolParams
          };
        }
      }

      // Stream assistant response tokens using LLM Runtime Engine
      const messages = [
        { role: 'system', content: agent.systemPrompt },
        { role: 'user', content: message }
      ];

      for await (const chunk of this.llmRuntime.streamWithFallback(messages)) {
        if (chunk.type === 'token') {
          yield { type: 'token', token: chunk.token, agent: agent.id };
        }
      }

      yield { type: 'done', finishReason: 'stop', executionChain };
      return;
    }

    // Safety fallback if maximum hops reached
    yield {
      type: 'token',
      token: 'I have routed your request through our specialist team. How else may I assist you?',
      agent: AGENT_ROLES.SUPERVISOR
    };
    yield { type: 'done', finishReason: 'max_hops_exceeded', executionChain };
  }
}
