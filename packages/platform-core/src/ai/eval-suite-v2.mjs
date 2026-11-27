/**
 * ============================================================================
 * Operza AI Evaluation Suite 2.0 — Deterministic CI Quality & Safety Gates
 * ============================================================================
 */

import { validateAgentPlan } from './agent-orchestrator-v2.mjs';
import { hybridRetrieveWithBudget, detectSourceConflicts } from './rag-v2.mjs';
import { createMemoryManagerV2 } from './memory-manager-v2.mjs';
import { createModelRouterV2 } from './model-router-v2.mjs';

export function runAiEvaluationSuiteV2() {
  const results = [];

  // 1. Task Accuracy: Plan validation rejects undeclared tools
  const badPlan = validateAgentPlan(
    { objective: 'Export DB', steps: [{ action: 'run_sql', tool: 'raw_sql_exec' }] },
    { allowedTools: ['search_contacts'] }
  );
  results.push({ id: 'safety_unauthorized_plan_tool', category: 'safety', passed: badPlan.valid === false });

  // 2. RAG Quality: Citation retrieval, deleted exclusion, and conflict detection
  const ragRes = hybridRetrieveWithBudget({
    query: 'refund policy days',
    agencyId: 'ag-1',
    locationId: 'loc-1',
    chunks: [
      { id: 'c1', sourceId: 's1', agencyId: 'ag-1', locationId: 'loc-1', title: 'Policy A', content: 'Refund policy allows 14 days for full refund.', tokenCount: 15 },
      { id: 'c2', sourceId: 's2', agencyId: 'ag-1', locationId: 'loc-1', title: 'Policy B', content: 'Refund policy allows 30 days for full refund.', tokenCount: 15 },
      { id: 'c3', sourceId: 's3', agencyId: 'ag-2', locationId: 'loc-1', title: 'Other Tenant', content: 'Refund policy 90 days.', tokenCount: 15 },
      { id: 'c4', sourceId: 's4', agencyId: 'ag-1', locationId: 'loc-1', deletedAt: '2026-01-01', content: 'Deleted refund policy 60 days.', tokenCount: 15 }
    ]
  });
  const conflicts = detectSourceConflicts(ragRes.matches);
  results.push({
    id: 'rag_isolation_and_conflict',
    category: 'rag',
    passed: ragRes.matches.length === 2 && conflicts.length === 1 && ragRes.citations.every(c => c.sourceId !== 's3' && c.sourceId !== 's4')
  });

  // 3. Memory Isolation: User A memory invisible to User B
  const mem = createMemoryManagerV2();
  mem.createMemory({ agencyId: 'ag-1', locationId: 'loc-1', scope: 'user', userId: 'u1', memoryKey: 'pref', content: 'Prefers concise summaries' });
  const u2Views = mem.retrieveMemories({ agencyId: 'ag-1', locationId: 'loc-1', userId: 'u2' });
  results.push({ id: 'memory_user_isolation', category: 'safety', passed: u2Views.length === 0 });

  // 4. Cost & Model Routing: Zero budget refuses paid fallback
  const router = createModelRouterV2();
  const routed = router.routeModel({
    preferredModelId: 'gemini-1.5-flash',
    requiredCapabilities: ['toolCalling'],
    remainingBudgetMicrocents: 0,
    allowPaidFallback: true
  });
  results.push({
    id: 'budget_safe_fallback',
    category: 'reliability',
    passed: routed.ok && routed.model.modelId === 'operza-deterministic-v1' && routed.degraded === true
  });

  const passedCount = results.filter(r => r.passed).length;
  return {
    datasetVersion: 'operza-ai-eval-v2.0',
    totalCases: results.length,
    passedCases: passedCount,
    failedCases: results.length - passedCount,
    passed: passedCount === results.length,
    results
  };
}
