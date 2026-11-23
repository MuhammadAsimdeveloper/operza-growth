/**
 * ============================================================================
 * Operza Opportunities Repository — Domain Boundary
 * ============================================================================
 * Encapsulates all Opportunity aggregate persistence logic strictly through
 * TenantTx instances, enforcing multi-tenant PostgreSQL Row Level Security (RLS)
 * on the dedicated opportunities table.
 */

import { randomUUID } from 'node:crypto';

const ALLOWED_SORT_FIELDS = new Set([
  'name',
  'value',
  'status',
  'created_at',
  'updated_at',
  'close_date',
  'createdAt',
  'updatedAt',
  'closeDate'
]);

const VALID_STATUSES = new Set(['open', 'won', 'lost', 'abandoned']);

/**
 * Normalizes a database row from the opportunities table into a domain entity.
 *
 * @param {any} row
 * @returns {any}
 */
function normalizeOpportunityRow(row) {
  if (!row) return null;
  const customValues = typeof row.custom_values === 'string'
    ? JSON.parse(row.custom_values)
    : (row.custom_values || {});

  return {
    id: row.id,
    agencyId: row.agency_id || row.agencyId,
    locationId: row.location_id || row.locationId,
    pipelineId: row.pipeline_id || row.pipelineId,
    stageId: row.stage_id || row.stageId,
    contactId: row.contact_id || row.contactId || null,
    name: row.name,
    value: Number(row.value) || 0,
    status: row.status || 'open',
    ownerId: row.owner_id || row.ownerId || null,
    closeDate: row.close_date?.toISOString?.() || row.close_date || null,
    source: row.source || null,
    customValues,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

/**
 * Creates an instance of OpportunitiesRepository.
 *
 * @returns {any}
 */
export function createOpportunitiesRepository() {
  return {
    /**
     * Creates a new opportunity within the tenant transaction.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {any} data
     * @returns {Promise<any>}
     */
    async create(tx, data) {
      if (!data || typeof data !== 'object') {
        throw new Error('INVALID_OPPORTUNITY_PAYLOAD: Payload must be an object');
      }

      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!name || name.length > 200) {
        throw new Error('INVALID_OPPORTUNITY_NAME: Name must be between 1 and 200 characters');
      }

      const assignedId = (typeof data.id === 'string' && data.id.trim()) ? data.id.trim() : randomUUID();
      const pipelineId = (typeof data.pipelineId === 'string' && data.pipelineId.trim())
        ? data.pipelineId.trim()
        : (typeof data.pipeline_id === 'string' && data.pipeline_id.trim() ? data.pipeline_id.trim() : 'default');
      const stageId = (typeof data.stageId === 'string' && data.stageId.trim())
        ? data.stageId.trim()
        : (typeof data.stage_id === 'string' && data.stage_id.trim() ? data.stage_id.trim() : 'lead');
      const contactId = (typeof data.contactId === 'string' && data.contactId.trim())
        ? data.contactId.trim()
        : (typeof data.contact_id === 'string' && data.contact_id.trim() ? data.contact_id.trim() : null);

      const value = Number(data.value) || 0.0;
      let status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'open';
      if (!VALID_STATUSES.has(status)) {
        status = 'open';
      }

      const ownerId = (typeof data.ownerId === 'string' && data.ownerId.trim())
        ? data.ownerId.trim()
        : (typeof data.owner_id === 'string' && data.owner_id.trim() ? data.owner_id.trim() : null);
      const closeDate = data.closeDate || data.close_date || null;
      const source = typeof data.source === 'string' ? data.source.trim() : null;
      const customValues = (data.customValues && typeof data.customValues === 'object')
        ? data.customValues
        : ((data.custom_values && typeof data.custom_values === 'object') ? data.custom_values : {});

      const now = new Date().toISOString();

      const insertSql = `
        INSERT INTO opportunities (
          id, agency_id, location_id, pipeline_id, stage_id, contact_id,
          name, value, status, owner_id, close_date, source, custom_values,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *;
      `;

      const params = [
        assignedId,
        tx.agencyId,
        tx.locationId,
        pipelineId,
        stageId,
        contactId,
        name,
        value,
        status,
        ownerId,
        closeDate,
        source,
        JSON.stringify(customValues),
        now,
        now
      ];

      const res = await tx.query(insertSql, params);
      return normalizeOpportunityRow(res.rows[0]);
    },

    /**
     * Retrieves a single opportunity by ID within the tenant transaction.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @returns {Promise<any|null>}
     */
    async getById(tx, id) {
      if (!id || typeof id !== 'string') return null;

      const selectSql = `
        SELECT * FROM opportunities
        WHERE id = $1 AND agency_id = $2 AND location_id = $3
        LIMIT 1;
      `;

      const res = await tx.query(selectSql, [id.trim(), tx.agencyId, tx.locationId]);
      if (!res.rows || res.rows.length === 0) {
        return null;
      }
      return normalizeOpportunityRow(res.rows[0]);
    },

    /**
     * Lists opportunities within the active tenant with optional filtering, pagination, and sorting.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {any} [options={}]
     * @returns {Promise<{ opportunities: any[], total: number, page: number, limit: number }>}
     */
    async list(tx, options = {}) {
      const page = Math.max(1, Number(options.page) || 1);
      const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
      const offset = (page - 1) * limit;

      const sortBy = options.sortBy || 'created_at';
      if (!ALLOWED_SORT_FIELDS.has(sortBy)) {
        throw new Error(`INVALID_SORT_FIELD: '${sortBy}' is not an allowed sort field`);
      }

      // Map camelCase sort fields to SQL column names
      const sortColumn = sortBy === 'createdAt' ? 'created_at' : (sortBy === 'updatedAt' ? 'updated_at' : (sortBy === 'closeDate' ? 'close_date' : sortBy));
      const sortOrder = String(options.sortOrder || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const conditions = ['agency_id = $1', 'location_id = $2'];
      const params = [tx.agencyId, tx.locationId];
      let pIdx = 3;

      if (options.pipelineId) {
        conditions.push(`pipeline_id = $${pIdx++}`);
        params.push(options.pipelineId);
      }
      if (options.stageId) {
        conditions.push(`stage_id = $${pIdx++}`);
        params.push(options.stageId);
      }
      if (options.status) {
        conditions.push(`status = $${pIdx++}`);
        params.push(options.status.toLowerCase());
      }
      if (options.contactId) {
        conditions.push(`contact_id = $${pIdx++}`);
        params.push(options.contactId);
      }
      if (options.search || options.q) {
        const query = String(options.search || options.q).trim();
        if (query) {
          conditions.push(`name ILIKE $${pIdx++}`);
          params.push(`%${query}%`);
        }
      }

      const whereClause = conditions.join(' AND ');

      // Total count
      const countSql = `SELECT count(*)::int as count FROM opportunities WHERE ${whereClause};`;
      const countRes = await tx.query(countSql, params);
      const total = Number(countRes.rows[0]?.count) || 0;

      // Data query
      const dataSql = `
        SELECT * FROM opportunities
        WHERE ${whereClause}
        ORDER BY ${sortColumn} ${sortOrder}
        LIMIT $${pIdx++} OFFSET $${pIdx++};
      `;
      const dataParams = [...params, limit, offset];
      const dataRes = await tx.query(dataSql, dataParams);

      return {
        opportunities: (dataRes.rows || []).map(normalizeOpportunityRow),
        total,
        page,
        limit
      };
    },

    /**
     * Updates an opportunity's attributes within the tenant transaction.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @param {any} patch
     * @returns {Promise<any|null>}
     */
    async update(tx, id, patch = {}) {
      const existing = await this.getById(tx, id);
      if (!existing) return null;

      const name = typeof patch.name === 'string' ? patch.name.trim() : existing.name;
      const value = patch.value !== undefined ? (Number(patch.value) || 0) : existing.value;
      let status = typeof patch.status === 'string' ? patch.status.trim().toLowerCase() : existing.status;
      if (!VALID_STATUSES.has(status)) {
        status = existing.status;
      }
      const pipelineId = (typeof patch.pipelineId === 'string' && patch.pipelineId.trim())
        ? patch.pipelineId.trim()
        : existing.pipelineId;
      const stageId = (typeof patch.stageId === 'string' && patch.stageId.trim())
        ? patch.stageId.trim()
        : existing.stageId;
      const contactId = patch.contactId !== undefined ? (patch.contactId ? String(patch.contactId).trim() : null) : existing.contactId;
      const ownerId = patch.ownerId !== undefined ? (patch.ownerId ? String(patch.ownerId).trim() : null) : existing.ownerId;
      const closeDate = patch.closeDate !== undefined ? patch.closeDate : existing.closeDate;
      const source = patch.source !== undefined ? patch.source : existing.source;
      const customValues = patch.customValues && typeof patch.customValues === 'object'
        ? { ...existing.customValues, ...patch.customValues }
        : existing.customValues;

      const updateSql = `
        UPDATE opportunities
        SET name = $1, value = $2, status = $3, pipeline_id = $4, stage_id = $5,
            contact_id = $6, owner_id = $7, close_date = $8, source = $9,
            custom_values = $10, updated_at = now()
        WHERE id = $11 AND agency_id = $12 AND location_id = $13
        RETURNING *;
      `;

      const params = [
        name,
        value,
        status,
        pipelineId,
        stageId,
        contactId,
        ownerId,
        closeDate,
        source,
        JSON.stringify(customValues),
        id,
        tx.agencyId,
        tx.locationId
      ];

      const res = await tx.query(updateSql, params);
      if (!res.rows || res.rows.length === 0) return null;
      return normalizeOpportunityRow(res.rows[0]);
    },

    /**
     * Dedicated helper for pipeline Kanban stage moves.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @param {{ pipelineId?: string, stageId: string, status?: string }} stageUpdate
     * @returns {Promise<any|null>}
     */
    async updateStage(tx, id, { pipelineId, stageId, status } = {}) {
      if (!stageId) {
        throw new Error('INVALID_STAGE_UPDATE: stageId is required');
      }
      return this.update(tx, id, { pipelineId, stageId, status });
    },

    /**
     * Deletes an opportunity by ID within the tenant transaction.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async delete(tx, id) {
      if (!id || typeof id !== 'string') return false;

      const deleteSql = `
        DELETE FROM opportunities
        WHERE id = $1 AND agency_id = $2 AND location_id = $3;
      `;

      const res = await tx.query(deleteSql, [id.trim(), tx.agencyId, tx.locationId]);
      return (res.rowCount || 0) > 0;
    },

    /**
     * Aggregates count and total value grouped by stage_id and status for a pipeline.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} [pipelineId]
     * @returns {Promise<Array<{ stageId: string, status: string, count: number, totalValue: number }>>}
     */
    async getPipelineSummary(tx, pipelineId = null) {
      const summarySql = `
        SELECT stage_id, status, count(*)::int as count, coalesce(sum(value), 0)::numeric(14,2) as total_value
        FROM opportunities
        WHERE agency_id = $1 AND location_id = $2 AND ($3::text IS NULL OR pipeline_id = $3)
        GROUP BY stage_id, status;
      `;

      const res = await tx.query(summarySql, [tx.agencyId, tx.locationId, pipelineId]);
      return (res.rows || []).map(r => ({
        stageId: r.stage_id,
        status: r.status,
        count: Number(r.count),
        totalValue: Number(r.total_value)
      }));
    }
  };
}
