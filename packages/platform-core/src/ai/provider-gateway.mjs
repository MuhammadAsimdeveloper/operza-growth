/**
 * Phase 5 — Reusable AI Provider Gateway & Capability Abstraction
 * Supports honest provider status tracking, model discovery, capability routing,
 * embeddings, streaming, token normalization, and cost estimation without exposing secrets.
 */

import { computeEmbeddingVector } from '../copilot/rag-engine.mjs';

export const PROVIDER_STATUSES = Object.freeze({
  NOT_CONFIGURED: 'not_configured',
  CONFIGURED: 'configured',
  CREDENTIAL_VERIFIED: 'credential_verified',
  SANDBOX_VERIFIED: 'sandbox_verified',
  PRODUCTION_CONNECTED: 'production_connected',
  TEMPORARILY_UNAVAILABLE: 'temporarily_unavailable',
  DISABLED: 'disabled'
});

const DEFAULT_MODEL_CATALOG = Object.freeze([
  {
    id: 'gemini-1.5-flash',
    provider: 'gemini',
    contextWindow: 1000000,
    capabilities: {
      textGeneration: true,
      structuredOutput: true,
      toolCalling: true,
      streaming: true,
      embeddings: false,
      audioInput: true,
      audioOutput: false
    },
    pricingMicrocentsPer1k: { input: 7500, output: 30000 }
  },
  {
    id: 'text-embedding-004',
    provider: 'gemini',
    contextWindow: 2048,
    capabilities: {
      textGeneration: false,
      structuredOutput: false,
      toolCalling: false,
      streaming: false,
      embeddings: true,
      audioInput: false,
      audioOutput: false
    },
    pricingMicrocentsPer1k: { input: 2500, output: 0 }
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    contextWindow: 128000,
    capabilities: {
      textGeneration: true,
      structuredOutput: true,
      toolCalling: true,
      streaming: true,
      embeddings: false,
      audioInput: true,
      audioOutput: true
    },
    pricingMicrocentsPer1k: { input: 15000, output: 60000 }
  },
  {
    id: 'text-embedding-3-small',
    provider: 'openai',
    contextWindow: 8191,
    capabilities: {
      textGeneration: false,
      structuredOutput: false,
      toolCalling: false,
      streaming: false,
      embeddings: true,
      audioInput: false,
      audioOutput: false
    },
    pricingMicrocentsPer1k: { input: 2000, output: 0 }
  },
  {
    id: 'claude-3-5-haiku-latest',
    provider: 'anthropic',
    contextWindow: 200000,
    capabilities: {
      textGeneration: true,
      structuredOutput: true,
      toolCalling: true,
      streaming: true,
      embeddings: false,
      audioInput: false,
      audioOutput: false
    },
    pricingMicrocentsPer1k: { input: 80000, output: 400000 }
  },
  {
    id: 'operza-trigram-v1',
    provider: 'local_embeddings',
    contextWindow: 8192,
    capabilities: {
      textGeneration: false,
      structuredOutput: false,
      toolCalling: false,
      streaming: false,
      embeddings: true,
      audioInput: false,
      audioOutput: false
    },
    pricingMicrocentsPer1k: { input: 0, output: 0 }
  }
]);

export function sanitizeProviderError(err) {
  const raw = String(err?.message || 'AI provider request failed');
  const redacted = raw
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, 'sk-***')
    .replace(/AIza[a-zA-Z0-9_-]{8,}/g, 'AIza***')
    .replace(/(bearer\s+)[a-zA-Z0-9._-]+/gi, '$1***');
  return {
    code: err?.code || 'AI_PROVIDER_ERROR',
    message: redacted
  };
}

export function createAiProviderGateway({ providers = [], models = DEFAULT_MODEL_CATALOG } = {}) {
  const registry = new Map();
  const modelCatalog = [...models];

  function registerProvider(entry) {
    if (!entry?.id || !entry?.name) {
      throw Object.assign(new TypeError('Provider id and name are required'), { code: 'INVALID_PROVIDER' });
    }
    const status = entry.status || (entry.configured ? PROVIDER_STATUSES.CONFIGURED : PROVIDER_STATUSES.NOT_CONFIGURED);
    registry.set(entry.id, {
      id: entry.id,
      name: entry.name,
      status,
      configured: Boolean(entry.configured),
      capabilities: {
        textGeneration: Boolean(entry.capabilities?.textGeneration),
        structuredOutput: Boolean(entry.capabilities?.structuredOutput),
        toolCalling: Boolean(entry.capabilities?.toolCalling),
        streaming: Boolean(entry.capabilities?.streaming),
        embeddings: Boolean(entry.capabilities?.embeddings),
        audioInput: Boolean(entry.capabilities?.audioInput),
        audioOutput: Boolean(entry.capabilities?.audioOutput)
      },
      complete: entry.complete || null,
      stream: entry.stream || null,
      embed: entry.embed || null,
      verifyConnection: entry.verifyConnection || null
    });
  }

  for (const p of providers) {
    registerProvider(p);
  }

  function listProviders() {
    return Array.from(registry.values()).map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      configured: p.configured,
      capabilities: { ...p.capabilities }
    }));
  }

  function listModels({ providerId = null } = {}) {
    return modelCatalog
      .filter((m) => !providerId || m.provider === providerId)
      .map((m) => {
        const p = registry.get(m.provider);
        return {
          ...m,
          providerStatus: p ? p.status : PROVIDER_STATUSES.NOT_CONFIGURED,
          available: Boolean(
            p &&
            p.status !== PROVIDER_STATUSES.NOT_CONFIGURED &&
            p.status !== PROVIDER_STATUSES.DISABLED &&
            p.status !== PROVIDER_STATUSES.TEMPORARILY_UNAVAILABLE
          )
        };
      });
  }

  function estimateCostMicrocents({ model, inputTokens = 0, outputTokens = 0 } = {}) {
    const spec = modelCatalog.find((m) => m.id === model);
    if (!spec) {
      return { estimated: false, microcents: 0, reason: 'UNKNOWN_MODEL_PRICING' };
    }
    const inCost = Math.ceil((Math.max(0, inputTokens) / 1000) * spec.pricingMicrocentsPer1k.input);
    const outCost = Math.ceil((Math.max(0, outputTokens) / 1000) * spec.pricingMicrocentsPer1k.output);
    return {
      estimated: true,
      microcents: inCost + outCost
    };
  }

  function selectModel({
    preferredProvider = null,
    preferredModel = null,
    requiresTools = false,
    requiresStreaming = false,
    requiresEmbeddings = false
  } = {}) {
    const candidates = listModels().filter((m) => {
      if (!m.available) return false;
      if (preferredProvider && m.provider !== preferredProvider) return false;
      if (preferredModel && m.id !== preferredModel) return false;
      if (requiresTools && !m.capabilities.toolCalling) return false;
      if (requiresStreaming && !m.capabilities.streaming) return false;
      if (requiresEmbeddings && !m.capabilities.embeddings) return false;
      return true;
    });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.pricingMicrocentsPer1k.input - b.pricingMicrocentsPer1k.input);
    return candidates[0];
  }

  async function testProviderConnection(providerId) {
    const p = registry.get(providerId);
    if (!p) {
      throw Object.assign(new Error(`Provider '${providerId}' not found`), { code: 'PROVIDER_NOT_FOUND' });
    }
    if (!p.configured || p.status === PROVIDER_STATUSES.NOT_CONFIGURED) {
      return { ok: false, status: PROVIDER_STATUSES.NOT_CONFIGURED, reason: 'Credentials not configured' };
    }
    if (typeof p.verifyConnection === 'function') {
      const result = await p.verifyConnection();
      p.status = result.ok ? (result.status || PROVIDER_STATUSES.CREDENTIAL_VERIFIED) : PROVIDER_STATUSES.TEMPORARILY_UNAVAILABLE;
      return { ok: Boolean(result.ok), status: p.status, details: result.details || null };
    }
    return { ok: true, status: p.status };
  }

  async function embedText(text, { providerId = null, dimensions = 64 } = {}) {
    if (providerId && providerId !== 'local_embeddings') {
      const p = registry.get(providerId);
      if (!p || !p.configured || typeof p.embed !== 'function') {
        throw Object.assign(new Error(`Embedding provider '${providerId}' is not configured`), { code: 'PROVIDER_NOT_CONFIGURED' });
      }
      return p.embed(text);
    }
    const vec = Array.from(computeEmbeddingVector(String(text || ''), dimensions));
    return {
      provider: 'local_embeddings',
      model: 'operza-trigram-v1',
      version: '1',
      dimensions,
      vector: vec,
      usage: { embeddingTokens: Math.max(1, Math.ceil(String(text || '').length / 4)) }
    };
  }

  async function complete({ providerId, model, messages, tools = [], temperature = 0.4, maxTokens = 1024 } = {}) {
    const p = registry.get(providerId);
    if (!p) {
      throw Object.assign(new Error(`Provider '${providerId}' is not registered`), { code: 'PROVIDER_NOT_FOUND' });
    }
    if (!p.configured || p.status === PROVIDER_STATUSES.NOT_CONFIGURED || p.status === PROVIDER_STATUSES.DISABLED) {
      throw Object.assign(new Error(`Provider '${providerId}' is ${p.status}`), { code: 'PROVIDER_NOT_CONFIGURED' });
    }
    if (typeof p.complete !== 'function') {
      throw Object.assign(new Error(`Provider '${providerId}' does not support text completion`), { code: 'CAPABILITY_UNSUPPORTED' });
    }
    try {
      const res = await p.complete(messages, { model, tools, temperature, maxTokens });
      const inputTokens = Number(res?.usage?.inputTokens ?? res?.usage?.promptTokens ?? 0);
      const outputTokens = Number(res?.usage?.outputTokens ?? res?.usage?.completionTokens ?? 0);
      const cost = estimateCostMicrocents({ model: res?.model || model, inputTokens, outputTokens });
      return {
        ...res,
        providerId: p.id,
        model: res?.model || model,
        usage: {
          inputTokens,
          outputTokens,
          estimatedCostMicrocents: cost.microcents,
          actualProviderCostMicrocents: res?.usage?.actualProviderCostMicrocents ?? null
        }
      };
    } catch (err) {
      const safe = sanitizeProviderError(err);
      throw Object.assign(new Error(safe.message), { code: safe.code });
    }
  }

  async function* stream({ providerId, model, messages, tools = [], temperature = 0.4, maxTokens = 1024 } = {}) {
    const p = registry.get(providerId);
    if (!p || !p.configured || p.status === PROVIDER_STATUSES.NOT_CONFIGURED || p.status === PROVIDER_STATUSES.DISABLED) {
      throw Object.assign(new Error(`Provider '${providerId}' is unavailable for streaming`), { code: 'PROVIDER_NOT_CONFIGURED' });
    }
    if (typeof p.stream === 'function') {
      yield* p.stream(messages, { model, tools, temperature, maxTokens });
      return;
    }
    const full = await complete({ providerId, model, messages, tools, temperature, maxTokens });
    if (full.content) {
      yield { type: 'token', token: full.content };
    }
    yield { type: 'done', usage: full.usage, finishReason: 'stop' };
  }

  return {
    registerProvider,
    listProviders,
    listModels,
    selectModel,
    estimateCostMicrocents,
    testProviderConnection,
    embedText,
    complete,
    stream
  };
}
