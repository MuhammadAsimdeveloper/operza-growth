/**
 * ============================================================================
 * Operza AI Automation & Agents 2.0 Router — TenantTx & FORCE RLS Boundary
 * ============================================================================
 */

import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createAi2Repository } from '../../../packages/db/lib/ai-2-repository.mjs';
import { createModelRouterV2 } from '../../../packages/platform-core/src/ai/model-router-v2.mjs';
import { SPECIALIZED_AGENTS, validateAgentPlan } from '../../../packages/platform-core/src/ai/agent-orchestrator-v2.mjs';
import { runAiEvaluationSuiteV2 } from '../../../packages/platform-core/src/ai/eval-suite-v2.mjs';

const ai2Repo = createAi2Repository();
const modelRouter = createModelRouterV2();

export async function handleAi2Routes(req, res, ctx) {
  const { method, pathname, actor, agency, activeLocation, pgPool, readBody, sendJson, auditLog } = ctx;

  if (!pathname.startsWith('/api/ai/v2/')) {
    return false;
  }

  const subPath = pathname.replace(/^\/api\/ai\/v2/, '');
  const tenantCtx = {
    agencyId: agency?.id,
    locationId: activeLocation?.id,
    actorId: actor?.user?.id || actor?.id || 'system'
  };

  if (method === 'GET' && subPath === '/models') {
    sendJson(res, 200, { models: modelRouter.listModels() });
    return true;
  }

  if (method === 'GET' && subPath === '/specialists') {
    sendJson(res, 200, { specialists: Object.values(SPECIALIZED_AGENTS) });
    return true;
  }

  if (subPath === '/agents') {
    if (!pgPool) {
      sendJson(res, 200, { agents: [] });
      return true;
    }
    if (method === 'GET') {
      const agents = await runInTenantTx(pgPool, tenantCtx, tx => ai2Repo.listAgents(tx));
      sendJson(res, 200, { agents });
      return true;
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const agent = await runInTenantTx(pgPool, tenantCtx, tx => ai2Repo.createAgent(tx, body || {}));
      auditLog?.('ai.v2.agent_created', actor, { id: agent.id });
      sendJson(res, 201, { agent });
      return true;
    }
  }

  if (subPath === '/runs') {
    if (!pgPool) {
      sendJson(res, 200, { runs: [] });
      return true;
    }
    if (method === 'GET') {
      const runs = await runInTenantTx(pgPool, tenantCtx, tx => ai2Repo.listRuns(tx));
      sendJson(res, 200, { runs });
      return true;
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const planCheck = validateAgentPlan(
        { objective: body?.objective || 'Run agent task', steps: body?.steps || [{ action: 'respond' }] },
        { allowedTools: body?.allowedTools || [] }
      );
      if (!planCheck.valid) {
        sendJson(res, 400, { error: 'Invalid agent plan', code: 'INVALID_AGENT_PLAN', errors: planCheck.errors });
        return true;
      }
      const created = await runInTenantTx(pgPool, tenantCtx, tx =>
        ai2Repo.createRunWithPlan(tx, {
          agentId: body?.agentId || null,
          userId: tenantCtx.actorId,
          objective: body?.objective || 'Run agent task',
          steps: body?.steps || [{ action: 'respond' }],
          validated: true
        })
      );
      sendJson(res, 201, created);
      return true;
    }
  }

  if (subPath === '/memories') {
    if (!pgPool) {
      sendJson(res, 200, { memories: [] });
      return true;
    }
    if (method === 'GET') {
      const memories = await runInTenantTx(pgPool, tenantCtx, tx => ai2Repo.listMemories(tx, { userId: tenantCtx.actorId }));
      sendJson(res, 200, { memories });
      return true;
    }
    if (method === 'POST') {
      const body = await readBody(req);
      try {
        const memory = await runInTenantTx(pgPool, tenantCtx, tx =>
          ai2Repo.createMemory(tx, { ...body, userId: tenantCtx.actorId })
        );
        sendJson(res, 201, { memory });
      } catch (err) {
        sendJson(res, 400, { error: err.message, code: err.code || 'MEMORY_ERROR' });
      }
      return true;
    }
  }

  if (method === 'POST' && subPath === '/evals/run') {
    const evalResult = runAiEvaluationSuiteV2();
    if (pgPool) {
      const saved = await runInTenantTx(pgPool, tenantCtx, tx => ai2Repo.recordEvalRun(tx, evalResult));
      sendJson(res, 200, { evalResult, record: saved });
      return true;
    }
    sendJson(res, 200, { evalResult });
    return true;
  }

  return false;
}
