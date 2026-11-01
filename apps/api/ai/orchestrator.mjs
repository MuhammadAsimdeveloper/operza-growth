/**
 * Operza Copilot — Central AI Orchestrator
 * Glues providers, tools, RAG, memories, usage tracking, and multi-step approval gates.
 */

import { executeAiCompletion, getModelMetadata } from './providers.mjs';
import { TOOL_REGISTRY, checkToolPermission } from './tools.mjs';
import { getAgent } from './agents.mjs';
import { queryKnowledgeBase, formatKnowledgeForPrompt } from './rag.mjs';
import { getAgencyMemories, formatMemoriesForPrompt } from './memory.mjs';
import { recordAiUsage, getAgencyUsageSummary } from './usage.mjs';
import { appendConversationMessage, getAgencyConversation } from './conversations.mjs';

export async function processCopilotMessage({
  agencyId,
  actor,
  conversationId,
  messageContent,
  agentId = 'general_business',
  modelOverride = null,
  state,
  saveState,
  auditLog,
  broadcast,
  executeWorkflowInstance,
  stream = false,
  onToken = null
}) {
  // 1. Budget enforcement check
  const usageSummary = getAgencyUsageSummary(state, agencyId);
  if (usageSummary.isBudgetExceeded) {
    throw new Error(`Agency daily AI spending budget ($${usageSummary.dailyBudgetLimit}) reached. Please adjust budget limit in settings or try again tomorrow.`);
  }

  // 2. Fetch conversation & history
  const conv = getAgencyConversation(state, agencyId, conversationId);
  if (!conv) throw new Error('Conversation not found');

  const activeAgent = getAgent(conv.agentId || agentId);
  const selectedModel = modelOverride || conv.model || activeAgent.model || 'gpt-4o';

  // 3. Append User Message to Database
  await appendConversationMessage(state, agencyId, conversationId, {
    role: 'user',
    content: messageContent
  }, saveState);

  // 4. Retrieve RAG Knowledge Context
  const relevantChunks = queryKnowledgeBase(state, agencyId, messageContent, 3);
  const knowledgeContext = formatKnowledgeForPrompt(relevantChunks);

  // 5. Retrieve User & Agency Persistent Memories
  const memories = getAgencyMemories(state, agencyId, actor.user.id);
  const memoryContext = formatMemoriesForPrompt(memories);

  // 6. Build System Prompt with Agent Personality & Delimited Context
  const baseSystemPrompt = activeAgent.systemPrompt;
  const fullSystemPrompt = `${baseSystemPrompt}
Current User: ${actor.user.name} (${actor.user.role})
Current Workspace: ${actor.agency.name}
Today's Date: ${new Date().toISOString().slice(0, 10)}
${memoryContext}
${knowledgeContext}
CRITICAL SAFETY & EXECUTION RULES:
1. Always ground your facts in the database and retrieved documents. Never fabricate fake deals, fake metrics, or fake contacts.
2. When calling tools, strictly adhere to the parameter schemas.
3. If an action involves sending live messages or triggering production workflows, clarify what will happen so the user can verify.`;

  // 7. Filter Tools by Agent Category & Actor RBAC
  const availableTools = Object.values(TOOL_REGISTRY).filter(t => {
    if (activeAgent.allowedCategories && !activeAgent.allowedCategories.includes(t.category)) {
      return false;
    }
    return checkToolPermission(t, actor);
  });

  // 8. Assemble Conversation History for Provider
  const messagesPayload = (conv.messages || []).slice(-10).map(m => ({
    role: m.role,
    content: m.content
  }));
  messagesPayload.push({ role: 'user', content: messageContent });

  // 9. Execute AI Completion
  const agencyIntegrations = state.records.integrations?.[agencyId] || [];
  const aiResult = await executeAiCompletion({
    provider: getModelMetadata(selectedModel).provider,
    model: selectedModel,
    messages: messagesPayload,
    systemPrompt: fullSystemPrompt,
    tools: availableTools,
    stream,
    onToken,
    agencyIntegrations
  });

  // 10. Record Token & Cost Accounting
  await recordAiUsage(state, agencyId, actor.user.id, {
    provider: aiResult.provider,
    model: aiResult.model,
    promptTokens: aiResult.promptTokens || 100,
    completionTokens: aiResult.completionTokens || 50
  }, saveState);

  // 11. Handle Tool Execution vs Sensitive Confirmation Gates
  const executedToolResults = [];
  let pendingApproval = null;

  if (aiResult.toolCalls && aiResult.toolCalls.length > 0) {
    for (const tc of aiResult.toolCalls) {
      const toolDef = TOOL_REGISTRY[tc.name];
      if (!toolDef) continue;

      // Check for Sensitive Action requiring user approval
      if (toolDef.classification === 'write_sensitive') {
        pendingApproval = {
          toolCallId: tc.id,
          toolId: toolDef.id,
          toolName: toolDef.name,
          parameters: tc.parameters,
          requiresConfirmation: true,
          explanation: `This action will perform: ${toolDef.description}`
        };
        break; // Halt and wait for user confirmation
      }

      // Auto-execute Read and Write_Reversible tools
      try {
        const result = await toolDef.execute(
          tc.parameters,
          actor,
          state,
          { saveState, auditLog, broadcast, executeWorkflowInstance }
        );
        executedToolResults.push({
          toolId: toolDef.id,
          name: toolDef.name,
          parameters: tc.parameters,
          result,
          success: true
        });
      } catch (err) {
        executedToolResults.push({
          toolId: toolDef.id,
          name: toolDef.name,
          parameters: tc.parameters,
          error: err.message,
          success: false
        });
      }
    }
  }

  // 12. Synthesize Final Response Content
  let finalContent = aiResult.content || '';
  if (executedToolResults.length > 0 && !finalContent) {
    const lines = [];
    for (const tr of executedToolResults) {
      if (tr.success) {
        if (tr.toolId === 'reporting_agency_metrics') {
          const m = tr.result;
          lines.push(`📊 **Agency Performance Report**:\n• **${m.totalContacts}** Active Contacts\n• **${m.totalOpportunities}** Pipeline Deals ($${m.pipelineValue.toLocaleString()} active / $${m.wonValue.toLocaleString()} won)\n• **${m.activeWorkflows}** Active Automation Workflows\n• **${m.pendingTasks}** Pending Tasks Requiring Follow-up`);
        } else if (tr.toolId === 'reporting_revenue_summary') {
          const r = tr.result;
          lines.push(`💰 **Revenue & Invoicing Snapshot**:\n• **$${r.totalCollectedRevenue.toLocaleString()}** Collected Revenue across ${r.paidInvoicesCount} paid invoices\n• **$${r.totalInvoicedAmount.toLocaleString()}** Total Invoiced (Collection Rate: ${r.collectionRate}%)`);
        } else if (tr.toolId === 'crm_search_contacts') {
          lines.push(`🔍 Found **${tr.result.count}** matching contact(s):\n` + tr.result.contacts.slice(0, 5).map(c => `• **${c.name}** (${c.email}) - ${c.company}`).join('\n'));
        } else if (tr.toolId === 'crm_find_duplicates') {
          lines.push(`👥 **Contact Duplicate Scan**:\nFound **${tr.result.duplicateClustersFound}** duplicate clusters across ${tr.result.totalContactsScanned} contacts.`);
        } else if (tr.toolId === 'crm_create_opportunity') {
          lines.push(`💼 Created deal **${tr.result.name}** valued at **$${Number(tr.result.value).toLocaleString()}** in stage *${tr.result.stage}*.`);
        } else if (tr.toolId === 'crm_create_contact') {
          lines.push(`✅ Created contact **${tr.result.name}** (${tr.result.email}) under **${tr.result.company}**.`);
        } else if (tr.toolId === 'workflows_list') {
          lines.push(`⚡ Found **${tr.result.total}** automation workflow(s) (${tr.result.active} active):\n` + tr.result.workflows.slice(0, 5).map(w => `• **${w.name}** [${w.status}] - Trigger: ${w.triggerType}`).join('\n'));
        } else {
          lines.push(`✅ Executed **${tr.name}** successfully.`);
        }
      } else {
        lines.push(`⚠️ Tool **${tr.name}** failed: ${tr.error}`);
      }
    }
    finalContent = lines.join('\n\n');
  }

  if (pendingApproval) {
    finalContent = (finalContent ? `${finalContent}\n\n` : '') +
      `⚠️ **Action Approval Required**: The assistant has prepared an action that requires your explicit confirmation before execution.\n\n**Action:** ${pendingApproval.toolName}\n**Parameters:**\n\`\`\`json\n${JSON.stringify(pendingApproval.parameters, null, 2)}\n\`\`\``;
  }

  // 13. Append Assistant Message to Database
  const assistantMessage = await appendConversationMessage(state, agencyId, conversationId, {
    role: 'assistant',
    content: finalContent,
    toolCalls: aiResult.toolCalls || [],
    toolResults: executedToolResults,
    approvalRequired: pendingApproval,
    approvalStatus: pendingApproval ? 'pending' : null,
    citations: relevantChunks.map(c => ({ docTitle: c.docTitle, chunkId: c.chunkId, excerpt: c.text.slice(0, 160) })),
    tokens: {
      prompt: aiResult.promptTokens || 100,
      completion: aiResult.completionTokens || 50,
      model: selectedModel,
      provider: aiResult.provider
    }
  }, saveState);

  return {
    conversationId,
    message: assistantMessage,
    agent: activeAgent,
    pendingApproval
  };
}

/**
 * Executes a pending sensitive action after explicit human approval.
 */
export async function executePendingApproval({
  agencyId,
  actor,
  conversationId,
  messageId,
  approved,
  state,
  saveState,
  auditLog,
  broadcast,
  executeWorkflowInstance
}) {
  const conv = getAgencyConversation(state, agencyId, conversationId);
  if (!conv) throw new Error('Conversation not found');

  const msg = (conv.messages || []).find(m => m.id === messageId);
  if (!msg || !msg.approvalRequired) {
    throw new Error('No pending approval found on this message');
  }

  if (msg.approvalStatus !== 'pending') {
    throw new Error(`This action was already ${msg.approvalStatus}`);
  }

  if (!approved) {
    msg.approvalStatus = 'rejected';
    await saveState();

    const rejectionMsg = await appendConversationMessage(state, agencyId, conversationId, {
      role: 'assistant',
      content: `❌ Action **${msg.approvalRequired.toolName}** was cancelled by ${actor.user.name}.`
    }, saveState);

    return { success: true, status: 'rejected', message: rejectionMsg };
  }

  // User approved: verify actor permissions and execute
  const toolDef = TOOL_REGISTRY[msg.approvalRequired.toolId];
  if (!toolDef) throw new Error('Tool not registered');
  if (!checkToolPermission(toolDef, actor)) {
    throw new Error('You do not have permission to approve this action');
  }

  msg.approvalStatus = 'approved';
  let executionResult = null;
  let success = true;

  try {
    executionResult = await toolDef.execute(
      msg.approvalRequired.parameters,
      actor,
      state,
      { saveState, auditLog, broadcast, executeWorkflowInstance }
    );
  } catch (err) {
    success = false;
    executionResult = { error: err.message };
  }

  await saveState();

  const confirmedMsg = await appendConversationMessage(state, agencyId, conversationId, {
    role: 'assistant',
    content: success
      ? `✅ **Action Approved & Executed**:\n${toolDef.name} completed successfully.\n\`\`\`json\n${JSON.stringify(executionResult, null, 2)}\n\`\`\``
      : `⚠️ Action **${toolDef.name}** failed during execution: ${executionResult.error}`,
    toolResults: [{ toolId: toolDef.id, name: toolDef.name, result: executionResult, success }]
  }, saveState);

  auditLog('ai.action_approved_executed', actor, { toolId: toolDef.id, success });
  return { success: true, status: 'approved', message: confirmedMsg, result: executionResult };
}
