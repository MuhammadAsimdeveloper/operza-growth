import { randomUUID } from 'node:crypto';

const VALID_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
const SORT_COLUMNS = new Map([
  ['dueDate', 'due_date'],
  ['createdAt', 'created_at'],
  ['updatedAt', 'updated_at'],
  ['priority', 'priority'],
  ['status', 'status']
]);

function mapTaskRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    title: row.title,
    notes: row.notes || '',
    contactId: row.contact_id || null,
    opportunityId: row.opportunity_id || null,
    assignedTo: row.assigned_to || null,
    priority: row.priority,
    status: row.status,
    dueDate: row.due_date || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function assertScope(tx, agencyId, locationId) {
  const a = agencyId || tx?.agencyId;
  const l = locationId || tx?.locationId;
  if (!a || !l) {
    throw new Error('TasksRepository requires explicit agencyId and locationId.');
  }
  return { agencyId: a, locationId: l };
}

export function createTasksRepository() {
  return {
    async listTasks(tx, {
      agencyId,
      locationId,
      contactId = null,
      opportunityId = null,
      status = null,
      assignedTo = null,
      sortBy = 'createdAt',
      sortDir = 'desc',
      limit = 100,
      offset = 0
    } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      const params = [scope.agencyId, scope.locationId];
      const filters = ['agency_id = $1', 'location_id = $2'];

      if (contactId) {
        params.push(contactId);
        filters.push(`contact_id = $${params.length}`);
      }
      if (opportunityId) {
        params.push(opportunityId);
        filters.push(`opportunity_id = $${params.length}`);
      }
      if (status && VALID_STATUSES.has(status)) {
        params.push(status);
        filters.push(`status = $${params.length}`);
      }
      if (assignedTo) {
        params.push(assignedTo);
        filters.push(`assigned_to = $${params.length}`);
      }

      const sortCol = SORT_COLUMNS.get(sortBy) || 'created_at';
      const dir = String(sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      params.push(Math.min(500, Math.max(1, Number(limit) || 100)));
      params.push(Math.max(0, Number(offset) || 0));

      const res = await tx.query(
        `SELECT * FROM tasks WHERE ${filters.join(' AND ')} ORDER BY ${sortCol} ${dir} LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      return res.rows.map(mapTaskRow);
    },

    async getTask(tx, { agencyId, locationId, id } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      if (!id) return null;
      const res = await tx.query(
        'SELECT * FROM tasks WHERE agency_id = $1 AND location_id = $2 AND id = $3',
        [scope.agencyId, scope.locationId, id]
      );
      return mapTaskRow(res.rows[0]);
    },

    async createTask(tx, input = {}) {
      const scope = assertScope(tx, input.agencyId, input.locationId);
      const title = String(input.title || '').trim();
      if (!title) throw new Error('Task title is required.');

      const priority = VALID_PRIORITIES.has(input.priority) ? input.priority : 'medium';
      const status = VALID_STATUSES.has(input.status) ? input.status : 'pending';
      const res = await tx.query(
        `INSERT INTO tasks (
          id, agency_id, location_id, title, notes, contact_id, opportunity_id,
          assigned_to, priority, status, due_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          input.id || randomUUID(),
          scope.agencyId,
          scope.locationId,
          title,
          input.notes || '',
          input.contactId || null,
          input.opportunityId || null,
          input.assignedTo || null,
          priority,
          status,
          input.dueDate || null
        ]
      );
      return mapTaskRow(res.rows[0]);
    },

    async updateTask(tx, { agencyId, locationId, id, patch = {} } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      const existing = await this.getTask(tx, { agencyId: scope.agencyId, locationId: scope.locationId, id });
      if (!existing) return null;

      const nextTitle = patch.title ? String(patch.title).trim() : existing.title;
      const nextNotes = patch.notes !== undefined ? String(patch.notes) : existing.notes;
      const nextAssigned = patch.assignedTo !== undefined ? patch.assignedTo : existing.assignedTo;
      const nextPriority = patch.priority && VALID_PRIORITIES.has(patch.priority) ? patch.priority : existing.priority;
      const nextStatus = patch.status && VALID_STATUSES.has(patch.status) ? patch.status : existing.status;
      const nextDueDate = patch.dueDate !== undefined ? patch.dueDate : existing.dueDate;
      const completedAt = nextStatus === 'completed'
        ? (existing.completedAt || new Date().toISOString())
        : null;

      const res = await tx.query(
        `UPDATE tasks
         SET title = $4, notes = $5, assigned_to = $6, priority = $7,
             status = $8, due_date = $9, completed_at = $10, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [
          scope.agencyId,
          scope.locationId,
          id,
          nextTitle,
          nextNotes,
          nextAssigned,
          nextPriority,
          nextStatus,
          nextDueDate,
          completedAt
        ]
      );
      return mapTaskRow(res.rows[0]);
    },

    async deleteTask(tx, { agencyId, locationId, id } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      const res = await tx.query(
        'DELETE FROM tasks WHERE agency_id = $1 AND location_id = $2 AND id = $3 RETURNING id',
        [scope.agencyId, scope.locationId, id]
      );
      return res.rowCount > 0;
    }
  };
}
