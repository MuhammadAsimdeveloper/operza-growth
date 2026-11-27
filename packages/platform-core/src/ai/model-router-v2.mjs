/**
 * ============================================================================
 * Operza AI Provider & Model Gateway 2.0 — Routing & Budget-Safe Fallback
 * ============================================================================
 * Advances provider-gateway.mjs with honest model readiness levels,
 * capability-based selection, and budget-gated fallback reporting.
 */

export const MODEL_READINESS = Object.freeze({
  CONFIGURED: 'configured',
  CONNECTION_TESTED: 'connection_tested',
  CAPABILITY_VERIFIED: 'capability_verified',
  OPERATIONALLY_VERIFIED: 'operationally_verified',
  UNAVAILABLE: 'unavailable'
});

const MODEL_REGISTRY_V2 = Object.freeze([
  {
    provider: 'gemini',
    modelId: 'gemini-1.5-flash',
    family: 'gemini-1.5',
    inputModalities: ['text', 'image', 'audio'],
    outputModalities: ['text', 'json'],
    contextWindow: 1_000_000,
    maxOutputTokens: 8192,
    toolCalling: true,
    structuredOutput: true,
    streaming: true,
    embeddings: false,
    pricingMicrocentsPer1k: { input: 7500, output: 30000 },
    paid: true
  },
  {
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    family: 'gpt-4o',
    inputModalities: ['text', 'image', 'audio'],
    outputModalities: ['text', 'json', 'audio'],
    contextWindow: 128_000,
    maxOutputTokens: 16384,
    toolCalling: true,
    structuredOutput: true,
    streaming: true,
    embeddings: false,
    pricingMicrocentsPer1k: { input: 15000, output: 60000 },
    paid: true
  },
  {
    provider: 'anthropic',
    modelId: 'claude-3-5-haiku-latest',
    family: 'claude-3.5',
    inputModalities: ['text', 'image'],
    outputModalities: ['text', 'json'],
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    toolCalling: true,
    structuredOutput: true,
    streaming: true,
    embeddings: false,
    pricingMicrocentsPer1k: { input: 80000, output: 400000 },
    paid: true
  },
  {
    provider: 'local_embedded',
    modelId: 'operza-deterministic-v1',
    family: 'operza-local',
    inputModalities: ['text'],
    outputModalities: ['text', 'json'],
    contextWindow: 32_768,
    maxOutputTokens: 4096,
    toolCalling: true,
    structuredOutput: true,
    streaming: false,
    embeddings: true,
    pricingMicrocentsPer1k: { input: 0, output: 0 },
    paid: false
  }
]);

export function createModelRouterV2({ initialReadiness = {} } = {}) {
  const readinessMap = new Map(Object.entries(initialReadiness));

  function getReadiness(modelId) {
    return readinessMap.get(modelId) || (modelId === 'operza-deterministic-v1'
      ? MODEL_READINESS.OPERATIONALLY_VERIFIED
      : MODEL_READINESS.UNAVAILABLE);
  }

  function setReadiness(modelId, status) {
    if (!Object.values(MODEL_READINESS).includes(status)) {
      throw new TypeError(`Invalid readiness status: ${status}`);
    }
    readinessMap.set(modelId, status);
  }

  function listModels() {
    return MODEL_REGISTRY_V2.map(m => ({
      ...m,
      readiness: getReadiness(m.modelId)
    }));
  }

  function routeModel({
    preferredModelId = 'gemini-1.5-flash',
    requiredCapabilities = [],
    minContextWindow = 4096,
    authorizedModels = null,
    remainingBudgetMicrocents = 0,
    allowPaidFallback = false
  } = {}) {
    const candidates = listModels().filter(m => {
      if (authorizedModels && !authorizedModels.includes(m.modelId)) return false;
      if (m.contextWindow < minContextWindow) return false;
      return requiredCapabilities.every(cap => Boolean(m[cap]));
    });

    const preferred = candidates.find(m => m.modelId === preferredModelId);
    if (preferred && preferred.readiness !== MODEL_READINESS.UNAVAILABLE) {
      if (!preferred.paid || remainingBudgetMicrocents > 0) {
        return { ok: true, model: preferred, degraded: false, reason: 'preferred_available' };
      }
    }

    // Controlled fallback: never fall back to a paid model unless authorized & budget permits
    const fallback = candidates.find(m => {
      if (m.modelId === preferredModelId) return false;
      if (m.readiness === MODEL_READINESS.UNAVAILABLE) return false;
      if (m.paid && (!allowPaidFallback || remainingBudgetMicrocents <= 0)) return false;
      return true;
    });

    if (fallback) {
      return {
        ok: true,
        model: fallback,
        degraded: true,
        reason: preferred ? 'preferred_unavailable_or_over_budget' : 'capability_routed_fallback'
      };
    }

    return {
      ok: false,
      code: 'NO_COMPATIBLE_MODEL_AVAILABLE',
      degraded: true
    };
  }

  return { listModels, getReadiness, setReadiness, routeModel };
}
