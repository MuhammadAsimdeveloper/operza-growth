/**
 * ============================================================================
 * Operza Unified LLM Runtime Engine
 * ============================================================================
 * 
 * Manages multiple LLM providers (Ollama, LocalAI, Cloud, and Embedded Offline)
 * with transparent fallback cascading.
 */

import { EmbeddedOfflineProvider } from './providers/embedded-offline.mjs';

export class LLMRuntimeEngine {
  /**
   * @param {Array<import('./interfaces.mjs').LLMProvider>} [providers]
   * @param {string[]} [fallbackSequence]
   */
  constructor(providers = [], fallbackSequence = ['ollama', 'localai', 'openai', 'embedded']) {
    this.providers = new Map();
    for (const p of providers) {
      this.providers.set(p.id, p);
    }
    // Ensure embedded offline provider is always present as the ultimate safety net
    if (!this.providers.has('embedded')) {
      const embedded = new EmbeddedOfflineProvider();
      this.providers.set(embedded.id, embedded);
    }
    this.fallbackSequence = fallbackSequence;
  }

  registerProvider(provider) {
    this.providers.set(provider.id, provider);
  }

  getProvider(providerId) {
    return this.providers.get(providerId) || null;
  }

  async listAvailableProviders() {
    const list = [];
    for (const [id, provider] of this.providers.entries()) {
      const available = await provider.isAvailable().catch(() => false);
      list.push({ id, name: provider.name, available });
    }
    return list;
  }

  /**
   * Completes a chat prompt with automatic fallback cascading.
   * @param {import('./interfaces.mjs').LLMMessage[]} messages
   * @param {import('./interfaces.mjs').LLMCompletionOptions} [options]
   */
  async complete(messages, options = {}) {
    return this.completeWithFallback(messages, options);
  }

  /**
   * Streams chat tokens with automatic fallback cascading.
   * @param {import('./interfaces.mjs').LLMMessage[]} messages
   * @param {import('./interfaces.mjs').LLMCompletionOptions} [options]
   */
  async *stream(messages, options = {}) {
    yield* this.streamWithFallback(messages, options);
  }

  /**
   * Completes a chat prompt with automatic fallback cascading.
   * @param {import('./interfaces.mjs').LLMMessage[]} messages
   * @param {import('./interfaces.mjs').LLMCompletionOptions} [options]
   */
  async completeWithFallback(messages, options = {}) {
    const preferred = options.preferredProvider || this.fallbackSequence[0];
    const candidateKeys = Array.from(new Set([preferred, ...this.fallbackSequence]));

    let lastError = null;
    for (const key of candidateKeys) {
      const provider = this.providers.get(key);
      if (!provider) continue;

      try {
        const available = await provider.isAvailable();
        if (!available) continue;
        const result = await provider.complete(messages, options);
        return {
          ...result,
          providerId: provider.id,
          providerName: provider.name
        };
      } catch (err) {
        lastError = err;
        console.warn(`[LLMRuntimeEngine] Provider '${key}' complete failed: ${err.message}. Cascading...`);
      }
    }

    // Ultimate fallback: embedded offline engine
    const offline = this.providers.get('embedded');
    const fallbackRes = await offline.complete(messages, options);
    return {
      ...fallbackRes,
      providerId: 'embedded',
      providerName: offline.name,
      fallbackEngaged: true,
      priorError: lastError?.message
    };
  }

  /**
   * Streams chat tokens with automatic fallback cascading.
   * @param {import('./interfaces.mjs').LLMMessage[]} messages
   * @param {import('./interfaces.mjs').LLMCompletionOptions} [options]
   */
  async *streamWithFallback(messages, options = {}) {
    const preferred = options.preferredProvider || this.fallbackSequence[0];
    const candidateKeys = Array.from(new Set([preferred, ...this.fallbackSequence]));

    for (const key of candidateKeys) {
      const provider = this.providers.get(key);
      if (!provider) continue;

      try {
        const available = await provider.isAvailable();
        if (!available) continue;
        yield* provider.stream(messages, options);
        return; // Success, stream finished
      } catch (err) {
        console.warn(`[LLMRuntimeEngine] Provider '${key}' stream failed: ${err.message}. Cascading...`);
      }
    }

    // Ultimate fallback: embedded offline engine
    const offline = this.providers.get('embedded');
    yield* offline.stream(messages, options);
  }
}
