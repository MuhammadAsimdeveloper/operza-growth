/**
 * ============================================================================
 * Operza Opportunities Domain Router — TenantTx & OpportunitiesRepository Boundary
 * ============================================================================
 * Handles all opportunity aggregate endpoints: CRUD, search, pagination, sorting,
 * pipeline filtering, stage moves, and stage summary aggregations.
 *
 * For database-backed environments (pgPool present), PostgreSQL Row Level
 * Security via TenantTx is the sole authoritative persistence mechanism.
 * In-memory / JSON persistence is strictly isolated as a fallback for zero-config
 * local development and offline testing (!pgPool).
 */

import { randomUUID } from 'node:crypto';
import { createOpportunitiesRepository } from '../../../packages/db/lib/opportunities-repository.mjs';
import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';

const opportunitiesRepo = createOpportunitiesRepository();

/**
 * Handles all opportunity-related HTTP requests.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {any} ctx
 * @returns {Promise<boolean>} - true if request was handled, false if unhandled
 */
export async function handleOpportunitiesRoutes(req, res, ctx) {
  const {
    method,
    pathname,
    url,
    readBody,
    sendJson,
    state,
    saveState,
    auditLog,
    broadcast,
    actor,
    agency,
    activeLocation,
    pgPool,
    triggerWorkflowExecution,
    dispatchZapierEvent
  } = ctx;

  const isOpportunityRoute = pathname.startsWith('/api/crm/opportunities') || pathname.startsWith('/api/opportunities');
  if (!isOpportunityRoute) {
    return false;
  }

  const queryUrl = url || new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
  const tenantCtx = (agency && activeLocation) ? {
    agencyId: agency.id,
    locationId: activeLocation.id,
    actorId: actor?.user?.id || actor?.keyId || 'system'
  } : null;

  function requireTenantContext() {
    if (!tenantCtx || !tenantCtx.agencyId || !tenantCtx.locationId) {
      sendJson(res, 400, { error: 'Active agency and location context required', code: 'TENANT_CONTEXT_REQUIRED' });
      return false;
    }
    return true;
  }

  // Parse path to check if an ID or sub-resource is specified
  // e.g. /api/crm/opportunities/:id or /api/opportunities/:id
  const basePath = pathname.startsWith('/api/crm/opportunities') ? '/api/crm/opportunities' : '/api/opportunities';
  const subPath = pathname.slice(basePath.length); // e.g. "", "/", "/pipeline-summary", "/:id"
  const cleanSubPath = subPath.startsWith('/') ? subPath.slice(1) : subPath;
  const pathParts = cleanSubPath.split('/').filter(Boolean);
  const recordId = pathParts.length > 0 && pathParts[0] !== 'pipeline-summary' ? pathParts[0] : null;
  const isSummaryRoute = cleanSubPath === 'pipeline-summary';

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Pipeline Summary: GET /api/crm/opportunities/pipeline-summary
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'GET' && isSummaryRoute) {
    if (!requireTenantContext()) return true;
    const pipelineId = queryUrl.searchParams.get('pipelineId') || queryUrl.searchParams.get('pipeline') || null;

    if (pgPool) {
      try {
        const summary = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return opportunitiesRepo.getPipelineSummary(tx, pipelineId);
        });
        sendJson(res, 200, { summary });
      } catch (err) {
        console.error('[OPPORTUNITIES-ROUTER] Error fetching pipeline summary:', err);
        sendJson(res, 500, { error: 'Failed to fetch pipeline summary', code: 'INTERNAL_ERROR' });
      }
      return true;
    }

    // In-memory zero-config fallback
    state.records.opportunities = state.records.opportunities || [];
    const filtered = state.records.opportunities.filter(
      o => o.agencyId === agency.id && o.locationId === activeLocation.id && (!pipelineId || o.pipelineId === pipelineId || o.pipeline === pipelineId)
    );

    const groups = {};
    for (const opp of filtered) {
      const stage = opp.stageId || opp.stage || 'lead';
      const status = opp.status || 'open';
      const key = `${stage}::${status}`;
      if (!groups[key]) {
        groups[key] = { stageId: stage, status, count: 0, totalValue: 0 };
      }
      groups[key].count += 1;
      groups[key].totalValue += Number(opp.value || 0);
    }

    sendJson(res, 200, { summary: Object.values(groups) });
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. List Opportunities: GET /api/crm/opportunities
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'GET' && !recordId) {
    if (!requireTenantContext()) return true;

    const page = Math.max(1, Number(queryUrl.searchParams.get('page')) || 1);
    const limit = Math.min(200, Math.max(1, Number(queryUrl.searchParams.get('limit')) || 25));
    const search = queryUrl.searchParams.get('search') || queryUrl.searchParams.get('q');
    const pipelineId = queryUrl.searchParams.get('pipelineId') || queryUrl.searchParams.get('pipeline');
    const stageId = queryUrl.searchParams.get('stageId') || queryUrl.searchParams.get('stage');
    const status = queryUrl.searchParams.get('status');
    const contactId = queryUrl.searchParams.get('contactId');
    const sortBy = queryUrl.searchParams.get('sort') || queryUrl.searchParams.get('sortBy') || 'createdAt';
    const sortOrder = queryUrl.searchParams.get('order') || queryUrl.searchParams.get('sortOrder') || 'desc';

    if (pgPool) {
      try {
        const result = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return opportunitiesRepo.list(tx, {
            page,
            limit,
            search,
            pipelineId,
            stageId,
            status,
            contactId,
            sortBy,
            sortOrder
          });
        });

        const totalPages = Math.ceil(result.total / limit);
        sendJson(res, 200, {
          data: result.opportunities,
          pagination: {
            page,
            limit,
            total: result.total,
            totalPages,
            hasMore: page < totalPages
          }
        });
      } catch (err) {
        console.error('[OPPORTUNITIES-ROUTER] Error listing opportunities:', err);
        sendJson(res, 500, { error: 'Failed to list opportunities', code: 'INTERNAL_ERROR' });
      }
      return true;
    }

    // In-memory zero-config fallback
    state.records.opportunities = state.records.opportunities || [];
    let list = state.records.opportunities.filter(
      r => r.agencyId === agency.id && (!r.locationId || !activeLocation || r.locationId === activeLocation.id)
    );

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r => (r.name && r.name.toLowerCase().includes(q)) || (r.source && r.source.toLowerCase().includes(q)));
    }
    if (pipelineId) {
      list = list.filter(r => (r.pipelineId && r.pipelineId.toLowerCase() === pipelineId.toLowerCase()) || (r.pipeline && r.pipeline.toLowerCase() === pipelineId.toLowerCase()));
    }
    if (stageId) {
      list = list.filter(r => (r.stageId && r.stageId.toLowerCase() === stageId.toLowerCase()) || (r.stage && r.stage.toLowerCase() === stageId.toLowerCase()));
    }
    if (status) {
      list = list.filter(r => r.status && r.status.toLowerCase() === status.toLowerCase());
    }
    if (contactId) {
      list = list.filter(r => r.contactId === contactId);
    }

    list.sort((a, b) => {
      const aVal = a[sortBy] ?? '';
      const bVal = b[sortBy] ?? '';
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortOrder.toLowerCase() === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortOrder.toLowerCase() === 'asc' ? cmp : -cmp;
    });

    const total = list.length;
    const startIdx = (page - 1) * limit;
    const pageData = list.slice(startIdx, startIdx + limit);
    const totalPages = Math.ceil(total / limit);

    sendJson(res, 200, {
      data: pageData,
      pagination: { page, limit, total, totalPages, hasMore: page < totalPages }
    });
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Get Opportunity by ID: GET /api/crm/opportunities/:id
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'GET' && recordId) {
    if (!requireTenantContext()) return true;

    if (pgPool) {
      try {
        const opp = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return opportunitiesRepo.getById(tx, recordId);
        });
        if (!opp) {
          sendJson(res, 404, { error: 'Opportunity not found' });
          return true;
        }
        sendJson(res, 200, opp);
      } catch (err) {
        console.error('[OPPORTUNITIES-ROUTER] Error getting opportunity:', err);
        sendJson(res, 500, { error: 'Failed to retrieve opportunity', code: 'INTERNAL_ERROR' });
      }
      return true;
    }

    // In-memory zero-config fallback
    state.records.opportunities = state.records.opportunities || [];
    const opp = state.records.opportunities.find(
      r => r.id === recordId && r.agencyId === agency.id && (!r.locationId || !activeLocation || r.locationId === activeLocation.id)
    );
    if (!opp) {
      sendJson(res, 404, { error: 'Opportunity not found' });
      return true;
    }
    sendJson(res, 200, opp);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Create Opportunity: POST /api/crm/opportunities
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'POST' && !recordId) {
    if (!requireTenantContext()) return true;
    const body = await readBody(req);

    // Defense-in-depth: strip forbidden client tenant ID injection
    delete body.agencyId;
    delete body.locationId;
    delete body.agency_id;
    delete body.location_id;

    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      sendJson(res, 400, { error: 'Opportunity name is required' });
      return true;
    }

    // Support stage and stageId synonyms
    if (body.stage && !body.stageId) {
      body.stageId = body.stage;
    }
    if (body.pipeline && !body.pipelineId) {
      body.pipelineId = body.pipeline;
    }

    if (pgPool) {
      try {
        const created = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return opportunitiesRepo.create(tx, body);
        });

        // Trigger workflow execution if configured
        if (typeof triggerWorkflowExecution === 'function') {
          triggerWorkflowExecution({
            agencyId: agency.id,
            locationId: activeLocation.id,
            triggerType: 'opportunity_created',
            triggerContext: { opportunity: created }
          }).catch(console.error);
        }

        // Dispatch Zapier REST hook event
        if (typeof dispatchZapierEvent === 'function') {
          dispatchZapierEvent({
            agencyId: agency.id,
            locationId: activeLocation.id,
            event: 'opportunity.created',
            data: created
          }).catch(console.error);
        }

        if (typeof auditLog === 'function') auditLog('crm.opportunities.created', actor, { id: created.id });
        if (typeof broadcast === 'function') broadcast('crm.opportunities.created', created);

        sendJson(res, 201, created);
      } catch (err) {
        console.error('[OPPORTUNITIES-ROUTER] Error creating opportunity:', err);
        sendJson(res, 500, { error: err.message || 'Failed to create opportunity', code: 'INTERNAL_ERROR' });
      }
      return true;
    }

    // In-memory zero-config fallback
    const assignedId = (body.id && typeof body.id === 'string' && body.id.trim()) ? body.id.trim() : randomUUID();
    const now = new Date().toISOString();
    const newRecord = {
      ...body,
      id: assignedId,
      agencyId: agency.id,
      locationId: activeLocation.id,
      name: body.name.trim(),
      value: Number(body.value) || 0,
      status: body.status || 'open',
      stage: body.stage || body.stageId || 'lead',
      stageId: body.stageId || body.stage || 'lead',
      pipeline: body.pipeline || body.pipelineId || 'default',
      pipelineId: body.pipelineId || body.pipeline || 'default',
      contactId: body.contactId || null,
      createdAt: now,
      updatedAt: now
    };

    state.records.opportunities = state.records.opportunities || [];
    state.records.opportunities.push(newRecord);
    if (typeof saveState === 'function') await saveState();

    if (typeof triggerWorkflowExecution === 'function') {
      triggerWorkflowExecution({
        agencyId: agency.id,
        locationId: activeLocation.id,
        triggerType: 'opportunity_created',
        triggerContext: { opportunity: newRecord }
      }).catch(console.error);
    }

    if (typeof dispatchZapierEvent === 'function') {
      dispatchZapierEvent({
        agencyId: agency.id,
        locationId: activeLocation.id,
        event: 'opportunity.created',
        data: newRecord
      }).catch(console.error);
    }

    if (typeof auditLog === 'function') auditLog('crm.opportunities.created', actor, { id: newRecord.id });
    if (typeof broadcast === 'function') broadcast('crm.opportunities.created', newRecord);

    sendJson(res, 201, newRecord);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Update Opportunity: PUT /api/crm/opportunities/:id
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'PUT' && recordId) {
    if (!requireTenantContext()) return true;
    const body = await readBody(req);

    // Strip forbidden tenant injection and ID mutation
    delete body.id;
    delete body.agencyId;
    delete body.locationId;
    delete body.agency_id;
    delete body.location_id;

    if (body.stage && !body.stageId) {
      body.stageId = body.stage;
    }
    if (body.pipeline && !body.pipelineId) {
      body.pipelineId = body.pipeline;
    }

    if (pgPool) {
      try {
        let previousStage = null;
        const updated = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          const existing = await opportunitiesRepo.getById(tx, recordId);
          if (!existing) return null;
          previousStage = existing.stageId;
          return opportunitiesRepo.update(tx, recordId, body);
        });

        if (!updated) {
          sendJson(res, 404, { error: 'Opportunity not found' });
          return true;
        }

        // Trigger workflow execution if stage changed
        const newStage = updated.stageId;
        if (newStage && previousStage && newStage !== previousStage) {
          if (typeof triggerWorkflowExecution === 'function') {
            triggerWorkflowExecution({
              agencyId: agency.id,
              locationId: activeLocation.id,
              triggerType: 'opportunity_stage',
              triggerContext: { opportunity: updated, stage: newStage, previousStage }
            }).catch(console.error);
          }

          if (typeof dispatchZapierEvent === 'function') {
            dispatchZapierEvent({
              agencyId: agency.id,
              locationId: activeLocation.id,
              event: 'opportunity.stage_changed',
              data: updated
            }).catch(console.error);
          }
        }

        if (typeof auditLog === 'function') auditLog('crm.opportunities.updated', actor, { id: recordId });
        if (typeof broadcast === 'function') broadcast('crm.opportunities.updated', { id: recordId, ...updated });

        sendJson(res, 200, updated);
      } catch (err) {
        console.error('[OPPORTUNITIES-ROUTER] Error updating opportunity:', err);
        sendJson(res, 500, { error: err.message || 'Failed to update opportunity', code: 'INTERNAL_ERROR' });
      }
      return true;
    }

    // In-memory zero-config fallback
    state.records.opportunities = state.records.opportunities || [];
    const index = state.records.opportunities.findIndex(
      r => r.id === recordId && r.agencyId === agency.id && (!r.locationId || !activeLocation || r.locationId === activeLocation.id)
    );
    if (index === -1) {
      sendJson(res, 404, { error: 'Opportunity not found' });
      return true;
    }

    const previousRecord = { ...state.records.opportunities[index] };
    const updated = {
      ...state.records.opportunities[index],
      ...body,
      id: recordId,
      agencyId: agency.id,
      locationId: activeLocation.id,
      updatedAt: new Date().toISOString()
    };

    state.records.opportunities[index] = updated;
    if (typeof saveState === 'function') await saveState();

    const previousStage = previousRecord.stage || previousRecord.stageId;
    const newStage = updated.stage || updated.stageId;
    if (newStage && previousStage && newStage !== previousStage) {
      if (typeof triggerWorkflowExecution === 'function') {
        triggerWorkflowExecution({
          agencyId: agency.id,
          locationId: activeLocation.id,
          triggerType: 'opportunity_stage',
          triggerContext: { opportunity: updated, stage: newStage, previousStage }
        }).catch(console.error);
      }

      if (typeof dispatchZapierEvent === 'function') {
        dispatchZapierEvent({
          agencyId: agency.id,
          locationId: activeLocation.id,
          event: 'opportunity.stage_changed',
          data: updated
        }).catch(console.error);
      }
    }

    if (typeof auditLog === 'function') auditLog('crm.opportunities.updated', actor, { id: recordId });
    if (typeof broadcast === 'function') broadcast('crm.opportunities.updated', { id: recordId, ...updated });

    sendJson(res, 200, updated);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Delete Opportunity: DELETE /api/crm/opportunities/:id
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'DELETE' && recordId) {
    if (!requireTenantContext()) return true;

    if (pgPool) {
      try {
        const deleted = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return opportunitiesRepo.delete(tx, recordId);
        });

        if (!deleted) {
          sendJson(res, 404, { error: 'Opportunity not found' });
          return true;
        }

        if (typeof auditLog === 'function') auditLog('crm.opportunities.deleted', actor, { id: recordId });
        if (typeof broadcast === 'function') broadcast('crm.opportunities.deleted', { id: recordId });

        sendJson(res, 200, { success: true });
      } catch (err) {
        console.error('[OPPORTUNITIES-ROUTER] Error deleting opportunity:', err);
        sendJson(res, 500, { error: 'Failed to delete opportunity', code: 'INTERNAL_ERROR' });
      }
      return true;
    }

    // In-memory zero-config fallback
    state.records.opportunities = state.records.opportunities || [];
    const index = state.records.opportunities.findIndex(
      r => r.id === recordId && r.agencyId === agency.id && (!r.locationId || !activeLocation || r.locationId === activeLocation.id)
    );
    if (index === -1) {
      sendJson(res, 404, { error: 'Opportunity not found' });
      return true;
    }

    state.records.opportunities.splice(index, 1);
    if (typeof saveState === 'function') await saveState();

    if (typeof auditLog === 'function') auditLog('crm.opportunities.deleted', actor, { id: recordId });
    if (typeof broadcast === 'function') broadcast('crm.opportunities.deleted', { id: recordId });

    sendJson(res, 200, { success: true });
    return true;
  }

  return false;
}
