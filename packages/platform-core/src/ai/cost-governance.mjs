/**
 * Phase 5 — AI Cost, Token, Rate & Monthly Budget Governance
 * Enforces per-request token limits, per-user rate limits, and per-tenant
 * monthly cost budgets without silently switching models.
 */

export function createAiCostGovernance({
  defaultMonthlyBudgetMicrocents = 50_000_000, // $50.00 default monthly cap
  defaultMaxTokensPerRequest = 8192,
  defaultUserRateLimitPerMin = 30
} = {}) {
  const tenantBudgets = new Map(); // `${agencyId}:${locationId}` -> microcents
  const tenantSpend = new Map(); // `${agencyId}:${locationId}:${monthKey}` -> { costMicrocents, inputTokens, outputTokens, embeddingTokens, voiceSeconds, events }
  const userWindows = new Map(); // `${agencyId}:${userId}` -> number[] timestamps

  function monthKey(now = Date.now()) {
    const d = new Date(now);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  function setTenantMonthlyBudget({ agencyId, locationId, budgetMicrocents }) {
    if (!Number.isFinite(budgetMicrocents) || budgetMicrocents < 0) {
      throw new TypeError('budgetMicrocents must be a non-negative number');
    }
    tenantBudgets.set(`${agencyId}:${locationId}`, Math.floor(budgetMicrocents));
  }

  function getTenantMonthlyBudget({ agencyId, locationId }) {
    const key = `${agencyId}:${locationId}`;
    return tenantBudgets.has(key) ? tenantBudgets.get(key) : defaultMonthlyBudgetMicrocents;
  }

  function getUsageSummary({ agencyId, locationId, now = Date.now() }) {
    const key = `${agencyId}:${locationId}:${monthKey(now)}`;
    const record = tenantSpend.get(key) || {
      costMicrocents: 0,
      inputTokens: 0,
      outputTokens: 0,
      embeddingTokens: 0,
      voiceSeconds: 0,
      events: 0
    };
    const budgetMicrocents = getTenantMonthlyBudget({ agencyId, locationId });
    return {
      month: monthKey(now),
      budgetMicrocents,
      remainingMicrocents: Math.max(0, budgetMicrocents - record.costMicrocents),
      ...record
    };
  }

  function checkPreflight({
    agencyId,
    locationId,
    userId = 'system',
    requestedMaxTokens = 1024,
    now = Date.now()
  } = {}) {
    if (!agencyId || !locationId) {
      return { allowed: false, code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required for AI execution' };
    }
    if (requestedMaxTokens > defaultMaxTokensPerRequest) {
      return {
        allowed: false,
        code: 'AI_TOKEN_LIMIT_EXCEEDED',
        message: `Requested maxTokens (${requestedMaxTokens}) exceeds per-request limit (${defaultMaxTokensPerRequest})`
      };
    }

    const rateKey = `${agencyId}:${userId}`;
    const cutoff = now - 60_000;
    const recent = (userWindows.get(rateKey) || []).filter((ts) => ts > cutoff);
    if (recent.length >= defaultUserRateLimitPerMin) {
      userWindows.set(rateKey, recent);
      return {
        allowed: false,
        code: 'AI_RATE_LIMIT_EXCEEDED',
        message: `User AI rate limit (${defaultUserRateLimitPerMin}/min) exceeded`
      };
    }
    recent.push(now);
    userWindows.set(rateKey, recent);

    const summary = getUsageSummary({ agencyId, locationId, now });
    if (summary.costMicrocents >= summary.budgetMicrocents) {
      return {
        allowed: false,
        code: 'AI_BUDGET_EXCEEDED',
        message: 'Tenant monthly AI budget exceeded; execution blocked without model substitution',
        summary
      };
    }

    return { allowed: true, summary };
  }

  function recordUsage({
    agencyId,
    locationId,
    userId = null,
    agentId = null,
    runId = null,
    provider,
    model,
    requestType = 'chat',
    inputTokens = 0,
    outputTokens = 0,
    embeddingTokens = 0,
    voiceSeconds = 0,
    estimatedCostMicrocents = 0,
    actualProviderCostMicrocents = null,
    status = 'recorded',
    now = Date.now()
  } = {}) {
    const key = `${agencyId}:${locationId}:${monthKey(now)}`;
    const current = tenantSpend.get(key) || {
      costMicrocents: 0,
      inputTokens: 0,
      outputTokens: 0,
      embeddingTokens: 0,
      voiceSeconds: 0,
      events: 0
    };
    const costToAdd = actualProviderCostMicrocents ?? estimatedCostMicrocents ?? 0;
    current.costMicrocents += Math.max(0, Number(costToAdd));
    current.inputTokens += Math.max(0, Number(inputTokens));
    current.outputTokens += Math.max(0, Number(outputTokens));
    current.embeddingTokens += Math.max(0, Number(embeddingTokens));
    current.voiceSeconds += Math.max(0, Number(voiceSeconds));
    current.events += 1;
    tenantSpend.set(key, current);

    return {
      agencyId,
      locationId,
      userId,
      agentId,
      runId,
      provider,
      model,
      requestType,
      inputTokens,
      outputTokens,
      embeddingTokens,
      voiceSeconds,
      estimatedCostMicrocents,
      actualProviderCostMicrocents,
      status,
      recordedAt: new Date(now).toISOString()
    };
  }

  return {
    setTenantMonthlyBudget,
    getTenantMonthlyBudget,
    getUsageSummary,
    checkPreflight,
    recordUsage
  };
}
