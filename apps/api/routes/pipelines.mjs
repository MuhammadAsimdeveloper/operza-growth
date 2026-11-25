/**
 * ============================================================================
 * Operza Pipelines Domain Router — TenantTx & PipelinesRepository Boundary
 * ============================================================================
 * Handles CRM pipelines and stages endpoints:
 * - GET/POST/PUT/DELETE /api/crm/pipelines, /api/crm/pipelines/:id
 * - GET/POST/PUT/DELETE /api/pipelines, /api/pipelines/:id
 */

import { randomUUID } from 'node:crypto';
import { createPipelinesRepository } from '../../../packages/db/lib/pipelines-repository.mjs';
import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';

const pipelinesRepo = createPipelinesRepository();

function checkScope(actor, requiredScope, alternativeScopes = []) {
  if (!actor || !actor.apiKey) return true;
  const scopes = actor.scopes || [];
  if (scopes.includes('*') || scopes.includes('all')) return true;
  if (scopes.includes(requiredScope)) return true;
  return alternativeScopes.some(alt => scopes.includes(alt));
}

export async function handlePipelinesRoutes(req, res, ctx) {
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
    pgPool
  } = ctx;

  const isPipelineRoute =
    pathname === '/api/crm/pipelines' ||
    pathname.startsWith('/api/crm/pipelines/') ||
    pathname === '/api/pipelines' ||
    pathname.startsWith('/api/pipelines/');

  if (!isPipelineRoute) {
    return false;
  }

  const queryUrl = url || new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
  const tenantCtx = (agency && activeLocation) ? {
    agencyId: agency.id,
    locationId: activeLocation.id,
    actorId: actor?.user?.id || actor?.keyId || 'system'
  } : null;

  if (!tenantCtx || !tenantCtx.agencyId || !tenantCtx.locationId) {
    sendJson(res, 400, { error: 'Active agency and location context required', code: 'TENANT_CONTEXT_REQUIRED' });
    return true;
  }

  const isCollectionPath = pathname === '/api/crm/pipelines' || pathname === '/api/pipelines';
  const pipelineId = isCollectionPath
    ? null
    : pathname.replace(/^\/api\/(crm\/)?pipelines\//, '').trim();

  // GET Collection
  if (method === 'GET' && isCollectionPath) {
    if (!checkScope(actor, 'pipelines:read', ['opportunities:read'])) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'pipelines:read'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    if (pgPool) {
      try {
        const result = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return pipelinesRepo.listPipelines(tx, {
            status: queryUrl.searchParams.get('status'),
            search: queryUrl.searchParams.get('search') || queryUrl.searchParams.get('q'),
            sort: queryUrl.searchParams.get('sort'),
            order: queryUrl.searchParams.get('order'),
            page: queryUrl.searchParams.get('page'),
            limit: queryUrl.searchParams.get('limit')
          });
        });
        sendJson(res, 200, { data: result.pipelines, count: result.total, pipelines: result.pipelines });
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to retrieve pipelines: ' + err.message });
      }
      return true;
    }

    state.records.pipelines = state.records.pipelines || [];
    let list = state.records.pipelines.filter(
      p => p.agencyId === agency.id && (!p.locationId || p.locationId === activeLocation.id)
    );
    const search = queryUrl.searchParams.get('search') || queryUrl.searchParams.get('q');
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => (p.name && p.name.toLowerCase().includes(q)) || (p.description && p.description.toLowerCase().includes(q)));
    }
    sendJson(res, 200, { data: list, count: list.length, pipelines: list });
    return true;
  }

  // POST Create
  if (method === 'POST' && isCollectionPath) {
    if (!checkScope(actor, 'pipelines:write', ['opportunities:write'])) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'pipelines:write'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    const body = await readBody(req);
    if (!body || typeof body.name !== 'string' || !body.name.trim()) {
      sendJson(res, 400, { error: 'Pipeline name is required', code: 'PIPELINE_NAME_REQUIRED' });
      return true;
    }

    const { agencyId: _a, locationId: _l, ...sanitized } = body;

    if (pgPool) {
      try {
        const created = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return pipelinesRepo.createPipeline(tx, sanitized);
        });
        auditLog('crm.pipelines.created', actor, { id: created.id });
        broadcast('crm.pipelines.created', created);
        sendJson(res, 201, created);
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to create pipeline: ' + err.message });
      }
      return true;
    }

    state.records.pipelines = state.records.pipelines || [];
    const created = {
      ...sanitized,
      id: randomUUID(),
      agencyId: agency.id,
      locationId: activeLocation.id,
      name: sanitized.name.trim(),
      stages: Array.isArray(sanitized.stages) ? sanitized.stages : [],
      status: sanitized.status || 'active',
      description: sanitized.description || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.records.pipelines.push(created);
    await saveState();
    auditLog('crm.pipelines.created', actor, { id: created.id });
    broadcast('crm.pipelines.created', created);
    sendJson(res, 201, created);
    return true;
  }

  // GET Single
  if (method === 'GET' && pipelineId) {
    if (!checkScope(actor, 'pipelines:read', ['opportunities:read'])) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'pipelines:read'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    if (pgPool) {
      try {
        const found = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return pipelinesRepo.getPipelineById(tx, pipelineId);
        });
        if (!found) {
          sendJson(res, 404, { error: 'Pipeline not found' });
          return true;
        }
        sendJson(res, 200, found);
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to retrieve pipeline: ' + err.message });
      }
      return true;
    }

    const found = (state.records.pipelines || []).find(
      p => p.id === pipelineId && p.agencyId === agency.id && (!p.locationId || p.locationId === activeLocation.id)
    );
    if (!found) {
      sendJson(res, 404, { error: 'Pipeline not found' });
      return true;
    }
    sendJson(res, 200, found);
    return true;
  }

  // PUT / PATCH Update
  if ((method === 'PUT' || method === 'PATCH') && pipelineId) {
    if (!checkScope(actor, 'pipelines:write', ['opportunities:write'])) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'pipelines:write'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    const body = await readBody(req);
    const { agencyId: _a, locationId: _l, id: _id, ...sanitized } = body || {};

    if (pgPool) {
      try {
        const updated = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return pipelinesRepo.updatePipeline(tx, pipelineId, sanitized);
        });
        if (!updated) {
          sendJson(res, 404, { error: 'Pipeline not found' });
          return true;
        }
        auditLog('crm.pipelines.updated', actor, { id: pipelineId });
        broadcast('crm.pipelines.updated', updated);
        sendJson(res, 200, updated);
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to update pipeline: ' + err.message });
      }
      return true;
    }

    state.records.pipelines = state.records.pipelines || [];
    const idx = state.records.pipelines.findIndex(
      p => p.id === pipelineId && p.agencyId === agency.id && (!p.locationId || p.locationId === activeLocation.id)
    );
    if (idx === -1) {
      sendJson(res, 404, { error: 'Pipeline not found' });
      return true;
    }
    const updated = {
      ...state.records.pipelines[idx],
      ...sanitized,
      id: pipelineId,
      agencyId: agency.id,
      locationId: activeLocation.id,
      updatedAt: new Date().toISOString()
    };
    state.records.pipelines[idx] = updated;
    await saveState();
    auditLog('crm.pipelines.updated', actor, { id: pipelineId });
    broadcast('crm.pipelines.updated', updated);
    sendJson(res, 200, updated);
    return true;
  }

  // DELETE
  if (method === 'DELETE' && pipelineId) {
    if (!checkScope(actor, 'pipelines:write', ['opportunities:write'])) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'pipelines:write'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    if (pgPool) {
      try {
        const deleted = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return pipelinesRepo.deletePipeline(tx, pipelineId);
        });
        if (!deleted) {
          sendJson(res, 404, { error: 'Pipeline not found' });
          return true;
        }
        auditLog('crm.pipelines.deleted', actor, { id: pipelineId });
        broadcast('crm.pipelines.deleted', { id: pipelineId });
        sendJson(res, 200, { success: true, id: pipelineId });
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to delete pipeline: ' + err.message });
      }
      return true;
    }

    state.records.pipelines = state.records.pipelines || [];
    const idx = state.records.pipelines.findIndex(
      p => p.id === pipelineId && p.agencyId === agency.id && (!p.locationId || p.locationId === activeLocation.id)
    );
    if (idx === -1) {
      sendJson(res, 404, { error: 'Pipeline not found' });
      return true;
    }
    state.records.pipelines.splice(idx, 1);
    await saveState();
    auditLog('crm.pipelines.deleted', actor, { id: pipelineId });
    broadcast('crm.pipelines.deleted', { id: pipelineId });
    sendJson(res, 200, { success: true, id: pipelineId });
    return true;
  }

  return false;
}
