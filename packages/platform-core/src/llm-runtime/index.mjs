/**
 * ============================================================================
 * Operza LLM Runtime Module Exports
 * ============================================================================
 */

import { LLMRuntimeEngine } from './runtime-engine.mjs';
import { EmbeddedOfflineProvider } from './providers/embedded-offline.mjs';
import { OllamaProvider } from './providers/ollama-provider.mjs';
import { LocalAIProvider } from './providers/localai-provider.mjs';
import { OpenAIProvider } from './providers/cloud-providers.mjs';

export {
  LLMRuntimeEngine,
  EmbeddedOfflineProvider,
  OllamaProvider,
  LocalAIProvider,
  OpenAIProvider
};

/**
 * Creates a pre-configured default LLM runtime engine for Operza.
 * @param {object} [options]
 * @returns {LLMRuntimeEngine}
 */
export function createDefaultLLMRuntime(options = {}) {
  const providers = [
    new OllamaProvider(options.ollama),
    new LocalAIProvider(options.localai),
    new OpenAIProvider(options.openai),
    new EmbeddedOfflineProvider(options.embedded)
  ];
  return new LLMRuntimeEngine(providers, ['ollama', 'localai', 'openai', 'embedded']);
}
