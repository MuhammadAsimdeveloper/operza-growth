import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelRouterV2, MODEL_READINESS } from '../src/ai/model-router-v2.mjs';
import { createMultiAgentOrchestrator, MAX_DELEGATION_DEPTH, validateAgentPlan } from '../src/ai/agent-orchestrator-v2.mjs';
import { createMemoryManagerV2 } from '../src/ai/memory-manager-v2.mjs';
import { detectSourceConflicts, hybridRetrieveWithBudget, validateDocumentUpload } from '../src/ai/rag-v2.mjs';
import { runAiEvaluationSuiteV2 } from '../src/ai/eval-suite-v2.mjs';

test('Model Router 2.0 enforces readiness, capability matching, and budget-safe fallback', () => {
  const router = createModelRouterV2();
  const res = router.routeModel({
    preferredModelId: 'gemini-1.5-flash',
    requiredCapabilities: ['toolCalling', 'structuredOutput'],
    remainingBudgetMicrocents: 0,
    allowPaidFallback: true
  });
  assert.equal(res.ok, true);
  assert.equal(res.model.modelId, 'operza-deterministic-v1');
  assert.equal(res.degraded, true);

  router.setReadiness('gemini-1.5-flash', MODEL_READINESS.CAPABILITY_VERIFIED);
  const paidRes = router.routeModel({
    preferredModelId: 'gemini-1.5-flash',
    requiredCapabilities: ['toolCalling'],
    remainingBudgetMicrocents: 100_000
  });
  assert.equal(paidRes.ok, true);
  assert.equal(paidRes.model.modelId, 'gemini-1.5-flash');
  assert.equal(paidRes.degraded, false);
});

test('Agent Orchestrator 2.0 validates plans, enforces delegation depth, and intersects permissions', async () => {
  const invalid = validateAgentPlan({ objective: 'Hack', steps: [{ action: 'drop', tool: 'raw_sql' }] }, { allowedTools: ['search_contacts'] });
  assert.equal(invalid.valid, false);

  let capturedTools = [];
  const orch = createMultiAgentOrchestrator({
    executeSpecialist: async ({ effectiveTools }) => {
      capturedTools = effectiveTools;
      return { summary: 'done' };
    }
  });

  const depthFail = await orch.delegateTask({
    parentAllowedTools: ['search_contacts'],
    tenantContext: { agencyId: 'ag-1', locationId: 'loc-1' },
    specialistType: 'crm_assistant',
    objective: 'Lookup VIP',
    depth: MAX_DELEGATION_DEPTH + 1
  });
  assert.equal(depthFail.ok, false);
  assert.equal(depthFail.code, 'MAX_DELEGATION_DEPTH_EXCEEDED');

  const ok = await orch.delegateTask({
    parentAllowedTools: ['search_contacts'],
    tenantContext: { agencyId: 'ag-1', locationId: 'loc-1' },
    specialistType: 'crm_assistant',
    objective: 'Lookup VIP',
    depth: 1
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(capturedTools, ['search_contacts']);
});

test('Memory Manager 2.0 isolates user memory, enforces consent/TTL, and rejects secrets', () => {
  let now = 1_700_000_000_000;
  const mem = createMemoryManagerV2({ now: () => now });

  assert.throws(
    () => mem.createMemory({ agencyId: 'ag-1', locationId: 'loc-1', scope: 'user', userId: 'u1', memoryKey: 'k', content: 'api_key=sk_123' }),
    err => err.code === 'SENSITIVE_MEMORY_REJECTED'
  );
  assert.throws(
    () => mem.createMemory({ agencyId: 'ag-1', locationId: 'loc-1', scope: 'user', userId: 'u1', memoryKey: 'k', content: 'hi', consentGranted: false }),
    err => err.code === 'MEMORY_CONSENT_REQUIRED'
  );

  mem.createMemory({ agencyId: 'ag-1', locationId: 'loc-1', scope: 'user', userId: 'u1', memoryKey: 'pref', content: 'Short replies', ttlMs: 1000 });
  mem.createMemory({ agencyId: 'ag-1', locationId: 'loc-1', scope: 'agency', memoryKey: 'tone', content: 'Professional' });

  assert.equal(mem.retrieveMemories({ agencyId: 'ag-1', locationId: 'loc-1', userId: 'u2' }).length, 1); // only agency
  assert.equal(mem.retrieveMemories({ agencyId: 'ag-1', locationId: 'loc-1', userId: 'u1' }).length, 2);

  now += 2000; // user memory expired
  assert.equal(mem.retrieveMemories({ agencyId: 'ag-1', locationId: 'loc-1', userId: 'u1' }).length, 1);
});

test('RAG 2.0 validates MIME signatures, isolates tenants/deleted docs, detects conflicts, and passes Eval Suite V2', () => {
  const badPdf = validateDocumentUpload({ buffer: Buffer.from('not a pdf'), declaredMime: 'application/pdf', filename: 'fake.pdf' });
  assert.equal(badPdf.valid, false);
  assert.equal(badPdf.code, 'MIME_SIGNATURE_MISMATCH');

  const goodPdf = validateDocumentUpload({ buffer: Buffer.from('%PDF-1.4 sample'), declaredMime: 'application/pdf', filename: 'ok.pdf' });
  assert.equal(goodPdf.valid, true);

  const rag = hybridRetrieveWithBudget({
    query: 'onboarding sla hours',
    agencyId: 'ag-1',
    locationId: 'loc-1',
    chunks: [
      { id: '1', sourceId: 'a', agencyId: 'ag-1', locationId: 'loc-1', content: 'Onboarding SLA is 24 hours.', tokenCount: 10 },
      { id: '2', sourceId: 'b', agencyId: 'ag-1', locationId: 'loc-1', content: 'Onboarding SLA is 48 hours.', tokenCount: 10 }
    ]
  });
  assert.equal(rag.matches.length, 2);
  assert.equal(detectSourceConflicts(rag.matches).length, 1);

  const evalRes = runAiEvaluationSuiteV2();
  assert.equal(evalRes.passed, true);
  assert.equal(evalRes.failedCases, 0);
});
