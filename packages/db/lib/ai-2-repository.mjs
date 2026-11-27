/**
 * ============================================================================
 * Operza AI Automation & Agents 2.0 Repository — TenantTx & FORCE RLS
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';

function parseJson(val, fallback) {
  if (val == null) return fallback;
  return typeof val === 'string' ? JSON.parse(val) : val;
}

export function createAi2Repository() {
  return {
    async createAgent(tx, {
      name,
      persona = 'executive',
      systemPrompt = '',
      provider = 'gemini',
      model = 'gemini-1.5-flash',
      maxSteps = 6,
      maxTokensPerRun = 4096,
      allowedTools = [],
      knowledgeBaseIds = [],
      guardrails = {},
      status = 'active'
    }) {
      const id = randomUUID();
      const res = await tx.query(
        `INSERT INTO ai_agents (
          id, agency_id, location_id, name, persona, system_prompt,
          provider, model, max_steps, max_tokens_per_run,
          allowed_tools, knowledge_base_ids, guardrails, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14)
        RETURNING *`,
        [
          id, tx.agencyId, tx.locationId, name, persona, systemPrompt,
          provider, model, Math.min(25, Math.max(1, Number(maxSteps) || 6)),
          Math.max(128, Number(maxTokensPerRun) || 4096),
          JSON.stringify(allowedTools), JSON.stringify(knowledgeBaseIds),
          JSON.stringify(guardrails), status
        ]
      );
      return res.rows[0];
    },

    async listAgents(tx) {
      const res = await tx.query(
        `SELECT id, agency_id, location_id, name, persona, provider, model, max_steps, max_tokens_per_run, allowed_tools, status, version, created_at, updated_at
         FROM ai_agents WHERE agency_id = $1 AND location_id = $2 ORDER BY created_at DESC`,
        [tx.agencyId, tx.locationId]
      );
      return res.rows;
    },

    async createRunWithPlan(tx, {
      agentId = null,
      userId = null,
      sessionId = randomUUID(),
      provider = 'local_embedded',
      model = 'operza-deterministic-v1',
      objective,
      steps = [],
      riskClassification = 'low',
      validated = true
    }) {
      const runId = randomUUID();
      const runRes = await tx.query(
        `INSERT INTO ai_runs (
          id, agency_id, location_id, agent_id, user_id, session_id,
          provider, model, status, steps_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'running', $9)
        RETURNING *`,
        [runId, tx.agencyId, tx.locationId, agentId, userId, sessionId, provider, model, steps.length]
      );
      const planId = randomUUID();
      const planRes = await tx.query(
        `INSERT INTO ai_agent_plans (
          id, agency_id, location_id, run_id, objective, steps_json,
          risk_classification, validated, status
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
        RETURNING *`,
        [planId, tx.agencyId, tx.locationId, runId, objective, JSON.stringify(steps), riskClassification, Boolean(validated), validated ? 'validated' : 'draft']
      );
      return { run: runRes.rows[0], plan: planRes.rows[0] };
    },

    async listRuns(tx, { limit = 50 } = {}) {
      const res = await tx.query(
        `SELECT id, agent_id, user_id, provider, model, status, steps_count, input_tokens, output_tokens, estimated_cost_microcents, duration_ms, error_code, created_at, finished_at
         FROM ai_runs WHERE agency_id = $1 AND location_id = $2 ORDER BY created_at DESC LIMIT $3`,
        [tx.agencyId, tx.locationId, Math.min(200, Math.max(1, Number(limit) || 50))]
      );
      return res.rows;
    },

    async createMemory(tx, {
      scope = 'user',
      userId = null,
      agentId = null,
      memoryKey,
      content,
      consentGranted = true,
      expiresAt = null
    }) {
      if (!consentGranted) {
        throw Object.assign(new Error('Consent required for AI memory'), { code: 'MEMORY_CONSENT_REQUIRED' });
      }
      const res = await tx.query(
        `INSERT INTO ai_agent_memories (
          id, agency_id, location_id, scope, user_id, agent_id, memory_key, content, consent_granted, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)
        RETURNING *`,
        [randomUUID(), tx.agencyId, tx.locationId, scope, scope === 'user' ? String(userId) : null, agentId, memoryKey, content, expiresAt ? new Date(expiresAt) : null]
      );
      return res.rows[0];
    },

    async listMemories(tx, { userId = null } = {}) {
      const res = await tx.query(
        `SELECT id, scope, user_id, agent_id, memory_key, content, expires_at, created_at
         FROM ai_agent_memories
         WHERE agency_id = $1 AND location_id = $2
           AND (expires_at IS NULL OR expires_at > now())
           AND (scope = 'agency' OR (scope = 'user' AND user_id = $3))
         ORDER BY created_at DESC`,
        [tx.agencyId, tx.locationId, userId ? String(userId) : '']
      );
      return res.rows;
    },

    async createDelegation(tx, { parentRunId, specialistType, depth = 1, parentAgentId = null }) {
      const res = await tx.query(
        `INSERT INTO ai_delegations (
          id, agency_id, location_id, parent_run_id, parent_agent_id, specialist_type, depth, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')
        RETURNING *`,
        [randomUUID(), tx.agencyId, tx.locationId, parentRunId, parentAgentId, specialistType, depth]
      );
      return res.rows[0];
    },

    async recordEvalRun(tx, evalResult) {
      const res = await tx.query(
        `INSERT INTO ai_eval_runs (
          id, agency_id, location_id, dataset_version, provider, model,
          passed, total_cases, passed_cases, failed_cases, metrics
        ) VALUES ($1, $2, $3, $4, 'local_embedded', 'operza-deterministic-v1', $5, $6, $7, $8, $9::jsonb)
        RETURNING *`,
        [
          randomUUID(), tx.agencyId, tx.locationId, evalResult.datasetVersion,
          evalResult.passed, evalResult.totalCases, evalResult.passedCases, evalResult.failedCases,
          JSON.stringify(parseJson(evalResult.results, []))
        ]
      );
      return res.rows[0];
    }
  };
}
