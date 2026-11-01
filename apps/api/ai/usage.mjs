/**
 * Operza Copilot — Usage Metering & Cost Controls
 * Accurately tracks token consumption, calculates USD costs per model,
 * and enforces agency budget caps.
 */

import { randomUUID } from 'crypto';
import { getModelMetadata } from './providers.mjs';

export async function recordAiUsage(
  state,
  agencyId,
  userId,
  { provider, model, promptTokens = 0, completionTokens = 0 },
  saveState
) {
  state.records.ai_usage = state.records.ai_usage || [];

  const meta = getModelMetadata(model);
  const promptCost = (promptTokens / 1000) * (meta.costPer1kPrompt || 0.001);
  const completionCost = (completionTokens / 1000) * (meta.costPer1kCompletion || 0.002);
  const totalCost = Number((promptCost + completionCost).toFixed(6));

  const record = {
    id: randomUUID(),
    agencyId,
    userId,
    provider,
    model,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd: totalCost,
    timestamp: new Date().toISOString()
  };

  state.records.ai_usage.push(record);
  await saveState();
  return record;
}

export function getAgencyUsageSummary(state, agencyId) {
  const allUsage = (state.records.ai_usage || []).filter(u => u.agencyId === agencyId);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  let totalTokens = 0;
  let totalCostUsd = 0;
  let todayTokens = 0;
  let todayCostUsd = 0;
  let monthTokens = 0;
  let monthCostUsd = 0;

  for (const u of allUsage) {
    const cost = Number(u.costUsd || 0);
    const tokens = Number(u.totalTokens || 0);
    totalTokens += tokens;
    totalCostUsd += cost;

    if (u.timestamp >= startOfDay) {
      todayTokens += tokens;
      todayCostUsd += cost;
    }
    if (u.timestamp >= startOfMonth) {
      monthTokens += tokens;
      monthCostUsd += cost;
    }
  }

  const dailyBudgetLimit = 50.0; // $50 daily budget cap
  const isBudgetExceeded = todayCostUsd >= dailyBudgetLimit;

  return {
    totalRequests: allUsage.length,
    totalTokens,
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    todayTokens,
    todayCostUsd: Number(todayCostUsd.toFixed(4)),
    monthTokens,
    monthCostUsd: Number(monthCostUsd.toFixed(4)),
    dailyBudgetLimit,
    isBudgetExceeded,
    usagePercentage: Math.min(100, Math.round((todayCostUsd / dailyBudgetLimit) * 100))
  };
}
