/**
 * ============================================================================
 * Operza Copilot 2.0 — Unified Multilingual AI Business Assistant Service
 * ============================================================================
 * 
 * Orchestrates genuine conversational intelligence, RAG knowledge retrieval,
 * structured tool calling, and streaming event delivery for Operza Copilot.
 */

import { randomUUID } from 'node:crypto';
import { resolveAIProvider } from './ai-provider.mjs';
import { buildSystemPrompt } from './system-prompt.mjs';
import { RAGEngine } from './rag-engine.mjs';
import { ToolRegistry, COPILOT_TOOLS } from './tool-registry.mjs';

const SESSION_TTL_MS = 30 * 60 * 1000; // 30-minute sliding window

export class CopilotService {
  constructor(options = {}) {
    this.provider = resolveAIProvider(options);
    this.rag = new RAGEngine(options);
    this.tools = new ToolRegistry(options.tools || COPILOT_TOOLS);
    this.sessions = new Map();

    // Clean up stale sessions periodically
    this._cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.sessions.entries()) {
        if (now - entry.lastAccess > SESSION_TTL_MS) {
          this.sessions.delete(key);
        }
      }
    }, 60000);
  }

  destroy() {
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
  }

  getSessionHistory(sessionId) {
    let entry = this.sessions.get(sessionId);
    if (!entry) {
      entry = { messages: [], lastAccess: Date.now() };
      this.sessions.set(sessionId, entry);
    } else {
      entry.lastAccess = Date.now();
    }
    return entry.messages;
  }

  /**
   * Non-streaming chat completion with multi-turn memory, RAG, and tool execution.
   */
  async chat({
    message = '',
    sessionId = randomUUID(),
    activeModule = '',
    agency = {},
    activeLocation = {},
    actor = {},
    state = {},
    platformRepository = null
  }) {
    if (!message || typeof message !== 'string') {
      throw new Error('User message is required.');
    }

    const history = this.getSessionHistory(sessionId);
    const agencyId = agency.id || 'default_agency';
    const aiConfig = state.aiConfig?.[agencyId] || {};

    // 1. RAG: Retrieve top matching knowledge chunks
    state.records = state.records || {};
    state.records.knowledge = state.records.knowledge || [];
    const retrievedSources = this.rag.searchKnowledge({
      query: message,
      agencyId,
      documents: state.records.knowledge,
      topK: 4
    });

    // 2. Build hierarchical system prompt
    const systemPrompt = buildSystemPrompt({
      agency,
      activeLocation,
      actor,
      activeModule,
      aiConfig,
      retrievedSources
    });

    // 3. Assemble conversation context (sliding window of max 12 recent messages)
    const recentHistory = history.slice(-12);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: message }
    ];

    // 4. Invoke AI provider with registered tools
    const toolDefs = this.tools.listTools();
    const completion = await this.provider.complete(messages, {
      tools: toolDefs,
      temperature: aiConfig.temperature ?? 0.7
    });

    let finalText = completion.text || '';
    const toolResults = [];
    let proposalCreated = null;

    // 5. Handle model-requested tool calls
    if (Array.isArray(completion.toolCalls) && completion.toolCalls.length > 0) {
      for (const tc of completion.toolCalls) {
        const result = await this.tools.executeTool({
          toolName: tc.name,
          params: tc.arguments,
          actor,
          agency,
          activeLocation,
          state,
          platformRepository
        });

        toolResults.push({
          tool: tc.name,
          callId: tc.id,
          result
        });

        if (result.isProposal) {
          proposalCreated = {
            id: result.proposalId,
            toolName: result.toolName,
            status: result.status,
            params: result.params
          };
        }

        // For read tools: re-feed result back to model for synthesis if text was empty or brief
        const toolDef = this.tools.getTool(tc.name);
        if (toolDef && toolDef.readOnly) {
          try {
            const secondPassMessages = [
              ...messages,
              { role: 'assistant', content: completion.text || `Executing ${tc.name}...` },
              { role: 'tool', name: tc.name, toolCallId: tc.id, content: JSON.stringify(result) },
              { role: 'user', content: 'Synthesize the tool result and answer my original question clearly in my language.' }
            ];
            const synthesis = await this.provider.complete(secondPassMessages, {
              temperature: aiConfig.temperature ?? 0.7
            });
            if (synthesis.text) {
              finalText = synthesis.text;
            }
          } catch (synthErr) {
            console.warn('[CopilotService] Synthesis pass warning:', synthErr.message);
          }
        }
      }
    }

    if (!finalText.trim()) {
      finalText = proposalCreated
        ? `I have prepared the requested action proposal (**${proposalCreated.toolName}**). Please review and approve it in Copilot Inbox before execution.`
        : 'Your request has been analyzed and processed.';
    }

    // 6. Record user and assistant messages in session history
    const userMsgRecord = { role: 'user', content: message, timestamp: new Date().toISOString() };
    const assistantMsgRecord = {
      role: 'assistant',
      content: finalText,
      timestamp: new Date().toISOString(),
      toolCalls: completion.toolCalls,
      toolResults,
      sources: retrievedSources.map((s) => ({ title: s.title, chunkId: s.chunkId, score: s.score })),
      proposal: proposalCreated
    };

    history.push(userMsgRecord, assistantMsgRecord);

    return {
      sessionId,
      message: {
        id: `msg_${randomUUID().slice(0, 8)}`,
        content: finalText,
        sender: 'assistant',
        agent: 'copilot',
        toolCalls: completion.toolCalls || [],
        toolResults,
        sources: retrievedSources.map((s) => ({ title: s.title, chunkId: s.chunkId, score: s.score })),
        proposal: proposalCreated,
        timestamp: new Date().toISOString()
      },
      tools: toolDefs.map((t) => t.name),
      historyLength: history.length
    };
  }

  /**
   * Real streaming chat completion yielding SSE-ready delta tokens and tool events.
   */
  async *chatStream({
    message = '',
    sessionId = randomUUID(),
    activeModule = '',
    agency = {},
    activeLocation = {},
    actor = {},
    state = {},
    platformRepository = null
  }) {
    yield { type: 'session', sessionId };

    if (!message || typeof message !== 'string') {
      yield { type: 'error', error: 'User message is required.' };
      yield { type: 'done', finishReason: 'error' };
      return;
    }

    const history = this.getSessionHistory(sessionId);
    const agencyId = agency.id || 'default_agency';
    const aiConfig = state.aiConfig?.[agencyId] || {};

    // 1. RAG retrieval
    yield { type: 'thinking', status: 'Analyzing workspace & knowledge documents...' };

    state.records = state.records || {};
    state.records.knowledge = state.records.knowledge || [];
    const retrievedSources = this.rag.searchKnowledge({
      query: message,
      agencyId,
      documents: state.records.knowledge,
      topK: 4
    });

    if (retrievedSources.length > 0) {
      yield {
        type: 'rag_retrieval',
        sources: retrievedSources.map((s) => ({ title: s.title, chunkId: s.chunkId, score: s.score }))
      };
    }

    // 2. Build hierarchical system prompt
    const systemPrompt = buildSystemPrompt({
      agency,
      activeLocation,
      actor,
      activeModule,
      aiConfig,
      retrievedSources
    });

    const recentHistory = history.slice(-12);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: message }
    ];

    const toolDefs = this.tools.listTools();
    let accumulatedText = '';
    let proposalCreated = null;

    try {
      for await (const chunk of this.provider.stream(messages, {
        tools: toolDefs,
        temperature: aiConfig.temperature ?? 0.7
      })) {
        if (chunk.type === 'token') {
          accumulatedText += chunk.token;
          yield { type: 'token', token: chunk.token, delta: chunk.token };
        } else if (chunk.type === 'tool_call') {
          const tc = chunk.toolCall;
          yield { type: 'tool_executing', tool: tc.name, params: tc.arguments || {} };

          const result = await this.tools.executeTool({
            toolName: tc.name,
            params: tc.arguments || {},
            actor,
            agency,
            activeLocation,
            state,
            platformRepository
          });

          if (result.isProposal) {
            proposalCreated = {
              id: result.proposalId,
              toolName: result.toolName,
              status: result.status,
              params: result.params
            };
            yield {
              type: 'proposal_created',
              proposalId: result.proposalId,
              toolName: result.toolName,
              status: result.status,
              params: result.params
            };
          } else {
            yield { type: 'tool_completed', tool: tc.name, result };
          }
        }
      }

      if (!accumulatedText.trim() && proposalCreated) {
        const msg = `I have generated an action proposal for **${proposalCreated.toolName}**. Please review and approve in Copilot Inbox before execution.`;
        accumulatedText = msg;
        yield { type: 'token', token: msg };
      }

      // Record in history
      history.push(
        { role: 'user', content: message, timestamp: new Date().toISOString() },
        {
          role: 'assistant',
          content: accumulatedText,
          timestamp: new Date().toISOString(),
          proposal: proposalCreated,
          sources: retrievedSources.map((s) => ({ title: s.title, chunkId: s.chunkId }))
        }
      );

      yield {
        type: 'done',
        done: true,
        completeText: accumulatedText,
        proposal: proposalCreated,
        sources: retrievedSources.map((s) => ({ title: s.title, chunkId: s.chunkId }))
      };
    } catch (err) {
      yield { type: 'error', error: err.message };
      yield { type: 'done', finishReason: 'error' };
    }
  }
}
