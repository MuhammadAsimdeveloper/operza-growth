/**
 * ============================================================================
 * Operza LLM Runtime Type Definitions & Schema Contracts
 * ============================================================================
 */

/**
 * Valid message roles in LLM conversations.
 * @typedef {'system' | 'user' | 'assistant' | 'tool'} LLMRole
 */

/**
 * @typedef {Object} LLMToolCall
 * @property {string} id
 * @property {string} name
 * @property {Record<string, any>} arguments
 */

/**
 * @typedef {Object} LLMMessage
 * @property {LLMRole} role
 * @property {string} content
 * @property {string} [name]
 * @property {string} [toolCallId]
 * @property {LLMToolCall[]} [toolCalls]
 */

/**
 * @typedef {Object} LLMToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {object} parameters
 */

/**
 * @typedef {Object} LLMCompletionOptions
 * @property {string} [model]
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {LLMToolDefinition[]} [tools]
 * @property {string} [preferredProvider]
 */

/**
 * @typedef {Object} LLMStreamChunk
 * @property {'token' | 'tool_call' | 'done'} type
 * @property {string} [token]
 * @property {{ id: string, name: string, argumentsDelta: string }} [toolCall]
 * @property {string} [finishReason]
 */
