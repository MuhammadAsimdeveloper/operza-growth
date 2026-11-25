/**
 * ============================================================================
 * Operza Pipelines Repository — Domain Boundary
 * ============================================================================
 * Encapsulates all Pipeline and PipelineStage aggregate persistence logic
 * strictly through TenantTx instances, enforcing PostgreSQL Row Level Security (RLS)
 * on dedicated `pipelines` and `pipeline_stages` tables (Migration 011).
 */

import { randomUUID } from 'node:crypto';

const VALID_STATUSES = new Set(['active', 'archived']);
const ALLOWED_SORT_FIELDS = new Set(['name', 'status', 'created_at', 'updated_at']);

function normalizeStageInput(stage, index) {
  if (typeof stage === 'string') {
    return {
      id: randomUUID(),
      name: stage.trim() || `Stage ${index + 1}`,
      position: index,
      probability: 100,
      status: 'active'
    };
  }
  const id = (typeof stage?.id === 'string' && stage.id.trim()) ? stage.id.trim() : randomUUID();
  const name = typeof stage?.name === 'string' && stage.name.trim() ? stage.name.trim() : `Stage ${index + 1}`;
  const position = Number.isFinite(Number(stage?.position)) ? Number(stage.position) : index;
  const probability = Number.isFinite(Number(stage?.probability)) ? Number(stage.probability) : 100;
  const status = typeof stage?.status === 'string' && VALID_STATUSES.has(stage.status.trim().toLowerCase())
    ? stage.status.trim().toLowerCase()
    : 'active';
  return { id, name, position, probability, status };
}

export function normalizePipelineRow(row, stagesRows = null) {
  if (!row) return null;
  let stages = Array.isArray(stagesRows) && stagesRows.length > 0
    ? stagesRows.map(s => ({
        id: s.id,
        pipelineId: s.pipeline_id || s.pipelineId,
        name: s.name,
        position: Number(s.position) || 0,
        probability: Number(s.probability ?? 100),
        status: s.status || 'active',
        createdAt: s.created_at?.toISOString?.() || s.created_at
      }))
    : (typeof row.stages === 'string' ? JSON.parse(row.stages) : (row.stages || []));

  return {
    id: row.id,
    agencyId: row.agency_id || row.agencyId,
    locationId: row.location_id || row.locationId,
    name: row.name,
    stages,
    status: row.status || 'active',
    description: row.description || '',
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

export function createPipelinesRepository() {
  async function syncStages(tx, pipelineId, normalizedStages) {
    await tx.query(
      `DELETE FROM pipeline_stages WHERE agency_id = $1 AND location_id = $2 AND pipeline_id = $3`,
      [tx.agencyId, tx.locationId, pipelineId]
    );
    for (const stage of normalizedStages) {
      await tx.query(
        `INSERT INTO pipeline_stages (
          id, agency_id, location_id, pipeline_id, name, position, probability, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          stage.id,
          tx.agencyId,
          tx.locationId,
          pipelineId,
          stage.name,
          stage.position,
          stage.probability,
          stage.status
        ]
      );
    }
  }

  return {
    async createPipeline(tx, data) {
      if (!data || typeof data !== 'object') {
        throw new Error('INVALID_PIPELINE_PAYLOAD: Payload must be an object');
      }
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!name || name.length > 120) {
        throw new Error('INVALID_PIPELINE_NAME: Name must be between 1 and 120 characters');
      }

      const assignedId = (typeof data.id === 'string' && data.id.trim()) ? data.id.trim() : randomUUID();
      const status = typeof data.status === 'string' && VALID_STATUSES.has(data.status.trim().toLowerCase())
        ? data.status.trim().toLowerCase()
        : 'active';
      const description = typeof data.description === 'string' ? data.description.trim() : null;
      const rawStages = Array.isArray(data.stages) ? data.stages : [];
      const normalizedStages = rawStages.map((s, idx) => normalizeStageInput(s, idx));
      const now = new Date();

      const res = await tx.query(
        `INSERT INTO pipelines (
          id, agency_id, location_id, name, stages, status, description, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          assignedId,
          tx.agencyId,
          tx.locationId,
          name,
          JSON.stringify(normalizedStages),
          status,
          description,
          now,
          now
        ]
      );

      if (normalizedStages.length > 0) {
        await syncStages(tx, assignedId, normalizedStages);
      }

      return normalizePipelineRow(res.rows[0], normalizedStages);
    },

    async getPipelineById(tx, id) {
      if (!id) return null;
      const res = await tx.query(
        `SELECT * FROM pipelines WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [tx.agencyId, tx.locationId, id]
      );
      if (res.rows.length === 0) return null;
      const stagesRes = await tx.query(
        `SELECT * FROM pipeline_stages WHERE agency_id = $1 AND location_id = $2 AND pipeline_id = $3 ORDER BY position ASC`,
        [tx.agencyId, tx.locationId, id]
      );
      return normalizePipelineRow(res.rows[0], stagesRes.rows);
    },

    async listPipelines(tx, options = {}) {
      const conditions = ['agency_id = $1', 'location_id = $2'];
      const params = [tx.agencyId, tx.locationId];
      let pIdx = 3;

      if (options.status && VALID_STATUSES.has(String(options.status).toLowerCase())) {
        conditions.push(`status = $${pIdx++}`);
        params.push(String(options.status).toLowerCase());
      }
      if (options.search && String(options.search).trim()) {
        conditions.push(`(name ILIKE $${pIdx} OR description ILIKE $${pIdx})`);
        params.push(`%${String(options.search).trim()}%`);
        pIdx++;
      }

      const whereClause = conditions.join(' AND ');
      const countRes = await tx.query(`SELECT count(*)::int AS total FROM pipelines WHERE ${whereClause}`, params);
      const total = Number(countRes.rows[0]?.total || 0);

      const sortField = ALLOWED_SORT_FIELDS.has(options.sort) ? options.sort : 'created_at';
      const sortOrder = String(options.order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
      const page = Math.max(1, Number(options.page) || 1);
      const offset = (page - 1) * limit;

      const listRes = await tx.query(
        `SELECT * FROM pipelines WHERE ${whereClause} ORDER BY ${sortField} ${sortOrder} LIMIT $${pIdx++} OFFSET $${pIdx++}`,
        [...params, limit, offset]
      );

      return {
        pipelines: listRes.rows.map(r => normalizePipelineRow(r)),
        total,
        page,
        limit
      };
    },

    async updatePipeline(tx, id, patch) {
      if (!id || !patch || typeof patch !== 'object') return null;
      const existing = await this.getPipelineById(tx, id);
      if (!existing) return null;

      const name = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : existing.name;
      if (name.length > 120) {
        throw new Error('INVALID_PIPELINE_NAME: Name must be at most 120 characters');
      }
      const status = typeof patch.status === 'string' && VALID_STATUSES.has(patch.status.trim().toLowerCase())
        ? patch.status.trim().toLowerCase()
        : existing.status;
      const description = patch.description !== undefined
        ? (typeof patch.description === 'string' ? patch.description.trim() : null)
        : existing.description;

      const hasStagesPatch = Array.isArray(patch.stages);
      const normalizedStages = hasStagesPatch
        ? patch.stages.map((s, idx) => normalizeStageInput(s, idx))
        : existing.stages;

      const res = await tx.query(
        `UPDATE pipelines
         SET name = $1, stages = $2, status = $3, description = $4, updated_at = now()
         WHERE agency_id = $5 AND location_id = $6 AND id = $7
         RETURNING *`,
        [name, JSON.stringify(normalizedStages), status, description, tx.agencyId, tx.locationId, id]
      );
      if (res.rows.length === 0) return null;

      if (hasStagesPatch) {
        await syncStages(tx, id, normalizedStages);
      }

      return normalizePipelineRow(res.rows[0], normalizedStages);
    },

    async deletePipeline(tx, id) {
      if (!id) return false;
      const res = await tx.query(
        `DELETE FROM pipelines WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [tx.agencyId, tx.locationId, id]
      );
      return (res.rowCount || 0) > 0;
    },

    async listStages(tx, pipelineId) {
      if (!pipelineId) return [];
      const res = await tx.query(
        `SELECT * FROM pipeline_stages WHERE agency_id = $1 AND location_id = $2 AND pipeline_id = $3 ORDER BY position ASC`,
        [tx.agencyId, tx.locationId, pipelineId]
      );
      return res.rows.map(s => ({
        id: s.id,
        pipelineId: s.pipeline_id,
        name: s.name,
        position: Number(s.position) || 0,
        probability: Number(s.probability ?? 100),
        status: s.status || 'active',
        createdAt: s.created_at?.toISOString?.() || s.created_at
      }));
    },

    async upsertStage(tx, pipelineId, stageData) {
      if (!pipelineId || !stageData) throw new Error('PIPELINE_AND_STAGE_REQUIRED');
      const normalized = normalizeStageInput(stageData, Number(stageData.position) || 0);
      const res = await tx.query(
        `INSERT INTO pipeline_stages (
          id, agency_id, location_id, pipeline_id, name, position, probability, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (agency_id, location_id, pipeline_id, id) DO UPDATE
        SET name = EXCLUDED.name, position = EXCLUDED.position, probability = EXCLUDED.probability, status = EXCLUDED.status
        RETURNING *`,
        [
          normalized.id,
          tx.agencyId,
          tx.locationId,
          pipelineId,
          normalized.name,
          normalized.position,
          normalized.probability,
          normalized.status
        ]
      );
      return res.rows[0];
    },

    async deleteStage(tx, pipelineId, stageId) {
      if (!pipelineId || !stageId) return false;
      const res = await tx.query(
        `DELETE FROM pipeline_stages WHERE agency_id = $1 AND location_id = $2 AND pipeline_id = $3 AND id = $4`,
        [tx.agencyId, tx.locationId, pipelineId, stageId]
      );
      return (res.rowCount || 0) > 0;
    }
  };
}
