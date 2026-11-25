/**
 * ============================================================================
 * Operza Tasks Domain Router — TenantTx Boundary
 * ============================================================================
 */

import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createTasksRepository } from '../../../packages/db/lib/tasks-repository.mjs';

const tasksRepo = createTasksRepository();

function checkScope(actor, requiredScope, alternativeScopes = []) {
  if (!actor || !actor.apiKey) return true;
  const scopes = actor.scopes || [];
  if (scopes.includes('*') || scopes.includes('all')) return true;
  if (scopes.includes(requiredScope)) return true;
  return alternativeScopes.some(alt => scopes.includes(alt));
}

function stripTenantFields(body) {
  if (!body || typeof body !== 'object') return {};
  const { agencyId: _a, locationId: _l, ...rest } = body;
  return rest;
}

export async function handleTasksRoutes(req, res, ctx) {
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
    randomUUID
  } = ctx;

  const isTasksPath =
    pathname === '/api/crm/tasks' ||
    pathname.startsWith('/api/crm/tasks/') ||
    pathname === '/api/tasks' ||
    pathname.startsWith('/api/tasks/');

  if (!isTasksPath) return false;

  const agencyId = agency?.id;
  const locationId = activeLocation?.id;
  const actorId = actor?.user?.id || 'system';
  const queryUrl = url || new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);

  const taskId = pathname === '/api/crm/tasks' || pathname === '/api/tasks'
    ? null
    : pathname.replace(/^\/api\/(?:crm\/)?tasks\//, '').trim();

  if (method === 'GET' && !taskId) {
    if (!checkScope(actor, 'tasks:read', ['crm:read'])) {
      sendJson(res, 403, { error: 'Insufficient API key scope (tasks:read required)' });
      return true;
    }
    const status = queryUrl.searchParams.get('status') || null;
    const contactId = queryUrl.searchParams.get('contactId') || null;
    const opportunityId = queryUrl.searchParams.get('opportunityId') || null;
    const assignedTo = queryUrl.searchParams.get('assignedTo') || null;

    if (pgPool) {
      const rows = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
        tasksRepo.listTasks(tx, { agencyId, locationId, status, contactId, opportunityId, assignedTo })
      );
      sendJson(res, 200, { data: rows, tasks: rows, total: rows.length });
      return true;
    }

    state.records.tasks = state.records.tasks || [];
    let rows = state.records.tasks.filter(
      t => t.agencyId === agencyId && (!locationId || t.locationId === locationId)
    );
    if (status) rows = rows.filter(t => t.status === status);
    if (contactId) rows = rows.filter(t => t.contactId === contactId);
    if (opportunityId) rows = rows.filter(t => t.opportunityId === opportunityId);
    if (assignedTo) rows = rows.filter(t => t.assignedTo === assignedTo);
    sendJson(res, 200, { data: rows, tasks: rows, total: rows.length });
    return true;
  }

  if (method === 'POST' && !taskId) {
    if (!checkScope(actor, 'tasks:write', ['crm:write'])) {
      sendJson(res, 403, { error: 'Insufficient API key scope (tasks:write required)' });
      return true;
    }
    const body = stripTenantFields(await readBody(req));
    if (!body.title || !String(body.title).trim()) {
      sendJson(res, 400, { error: 'Task title is required' });
      return true;
    }

    let created;
    if (pgPool) {
      created = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
        tasksRepo.createTask(tx, { ...body, agencyId, locationId })
      );
    } else {
      state.records.tasks = state.records.tasks || [];
      created = {
        id: randomUUID(),
        agencyId,
        locationId,
        title: String(body.title).trim(),
        notes: body.notes || '',
        contactId: body.contactId || null,
        opportunityId: body.opportunityId || null,
        assignedTo: body.assignedTo || null,
        priority: body.priority || 'medium',
        status: body.status || 'pending',
        dueDate: body.dueDate || null,
        completedAt: body.status === 'completed' ? new Date().toISOString() : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.records.tasks.push(created);
      await saveState();
    }

    auditLog?.('task.created', actor, { taskId: created.id, title: created.title });
    broadcast?.('crm.task.created', { id: created.id, title: created.title });
    sendJson(res, 201, created);
    return true;
  }

  if (method === 'GET' && taskId) {
    if (!checkScope(actor, 'tasks:read', ['crm:read'])) {
      sendJson(res, 403, { error: 'Insufficient API key scope (tasks:read required)' });
      return true;
    }
    const found = pgPool
      ? await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
          tasksRepo.getTask(tx, { agencyId, locationId, id: taskId })
        )
      : (state.records?.tasks || []).find(t => t.id === taskId && t.agencyId === agencyId && (!locationId || t.locationId === locationId));
    if (!found) {
      sendJson(res, 404, { error: 'Task not found' });
      return true;
    }
    sendJson(res, 200, found);
    return true;
  }

  if ((method === 'PUT' || method === 'PATCH') && taskId) {
    if (!checkScope(actor, 'tasks:write', ['crm:write'])) {
      sendJson(res, 403, { error: 'Insufficient API key scope (tasks:write required)' });
      return true;
    }
    const body = stripTenantFields(await readBody(req));
    let updated;
    if (pgPool) {
      updated = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
        tasksRepo.updateTask(tx, { agencyId, locationId, id: taskId, patch: body })
      );
    } else {
      const task = (state.records?.tasks || []).find(
        t => t.id === taskId && t.agencyId === agencyId && (!locationId || t.locationId === locationId)
      );
      if (task) {
        if (body.title) task.title = String(body.title).trim();
        if (body.notes !== undefined) task.notes = body.notes;
        if (body.assignedTo !== undefined) task.assignedTo = body.assignedTo;
        if (body.priority) task.priority = body.priority;
        if (body.dueDate !== undefined) task.dueDate = body.dueDate;
        if (body.status) {
          task.status = body.status;
          task.completedAt = body.status === 'completed' ? (task.completedAt || new Date().toISOString()) : null;
        }
        task.updatedAt = new Date().toISOString();
        await saveState();
        updated = task;
      }
    }
    if (!updated) {
      sendJson(res, 404, { error: 'Task not found' });
      return true;
    }
    auditLog?.('task.updated', actor, { taskId, status: updated.status });
    broadcast?.('crm.task.updated', { id: taskId, status: updated.status });
    sendJson(res, 200, updated);
    return true;
  }

  if (method === 'DELETE' && taskId) {
    if (!checkScope(actor, 'tasks:write', ['crm:write'])) {
      sendJson(res, 403, { error: 'Insufficient API key scope (tasks:write required)' });
      return true;
    }
    let deleted = false;
    if (pgPool) {
      deleted = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
        tasksRepo.deleteTask(tx, { agencyId, locationId, id: taskId })
      );
    } else {
      state.records.tasks = state.records.tasks || [];
      const idx = state.records.tasks.findIndex(
        t => t.id === taskId && t.agencyId === agencyId && (!locationId || t.locationId === locationId)
      );
      if (idx !== -1) {
        state.records.tasks.splice(idx, 1);
        await saveState();
        deleted = true;
      }
    }
    if (!deleted) {
      sendJson(res, 404, { error: 'Task not found' });
      return true;
    }
    auditLog?.('task.deleted', actor, { taskId });
    sendJson(res, 200, { success: true, id: taskId });
    return true;
  }

  return false;
}
