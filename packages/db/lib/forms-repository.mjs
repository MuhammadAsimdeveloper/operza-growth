import { randomUUID } from 'node:crypto';

const VALID_STATUSES = new Set(['draft', 'published', 'archived']);

function mapFormRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    name: row.name,
    description: row.description || '',
    publicSlug: row.public_slug || null,
    status: row.status,
    published: Boolean(row.published),
    fields: row.fields || [],
    completion: row.completion || {},
    submissions: Number(row.submissions_count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSubmissionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    formId: row.form_id,
    contactId: row.contact_id || null,
    idempotencyKey: row.idempotency_key || null,
    answers: row.answers || {},
    metadata: row.metadata || {},
    submittedAt: row.submitted_at,
    createdAt: row.created_at
  };
}

function assertScope(tx, agencyId, locationId) {
  const a = agencyId || tx?.agencyId;
  const l = locationId || tx?.locationId;
  if (!a || !l) {
    throw new Error('FormsRepository requires explicit agencyId and locationId.');
  }
  return { agencyId: a, locationId: l };
}

export function createFormsRepository() {
  return {
    async listForms(tx, { agencyId, locationId, status = null, limit = 100, offset = 0 } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      const params = [scope.agencyId, scope.locationId];
      const filters = ['agency_id = $1', 'location_id = $2'];
      if (status && VALID_STATUSES.has(status)) {
        params.push(status);
        filters.push(`status = $${params.length}`);
      }
      params.push(Math.min(500, Math.max(1, Number(limit) || 100)));
      params.push(Math.max(0, Number(offset) || 0));
      const res = await tx.query(
        `SELECT * FROM forms WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      return res.rows.map(mapFormRow);
    },

    async getForm(tx, { agencyId, locationId, id } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      if (!id) return null;
      const res = await tx.query(
        'SELECT * FROM forms WHERE agency_id = $1 AND location_id = $2 AND id = $3',
        [scope.agencyId, scope.locationId, id]
      );
      return mapFormRow(res.rows[0]);
    },

    async createForm(tx, input = {}) {
      const scope = assertScope(tx, input.agencyId, input.locationId);
      const id = input.id || randomUUID();
      const name = String(input.name || 'Untitled Form').trim() || 'Untitled Form';
      const published = Boolean(input.published || input.status === 'published');
      const status = VALID_STATUSES.has(input.status) ? input.status : (published ? 'published' : 'draft');
      const res = await tx.query(
        `INSERT INTO forms (
          id, agency_id, location_id, name, description, public_slug,
          status, published, fields, completion
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          id,
          scope.agencyId,
          scope.locationId,
          name,
          input.description || '',
          input.publicSlug || input.slug || null,
          status,
          published,
          JSON.stringify(Array.isArray(input.fields) ? input.fields : []),
          JSON.stringify(input.completion || {})
        ]
      );
      return mapFormRow(res.rows[0]);
    },

    async updateForm(tx, { agencyId, locationId, id, patch = {} } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      const existing = await this.getForm(tx, { agencyId: scope.agencyId, locationId: scope.locationId, id });
      if (!existing) return null;

      const published = patch.published !== undefined ? Boolean(patch.published) : existing.published;
      const status = patch.status && VALID_STATUSES.has(patch.status)
        ? patch.status
        : (patch.published !== undefined ? (published ? 'published' : 'draft') : existing.status);

      const res = await tx.query(
        `UPDATE forms
         SET name = $4, description = $5, public_slug = $6, status = $7, published = $8,
             fields = $9, completion = $10, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [
          scope.agencyId,
          scope.locationId,
          id,
          patch.name ? String(patch.name).trim() : existing.name,
          patch.description !== undefined ? patch.description : existing.description,
          patch.publicSlug !== undefined ? patch.publicSlug : existing.publicSlug,
          status,
          published,
          JSON.stringify(Array.isArray(patch.fields) ? patch.fields : existing.fields),
          JSON.stringify(patch.completion !== undefined ? patch.completion : existing.completion)
        ]
      );
      return mapFormRow(res.rows[0]);
    },

    async deleteForm(tx, { agencyId, locationId, id } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      const res = await tx.query(
        'DELETE FROM forms WHERE agency_id = $1 AND location_id = $2 AND id = $3 RETURNING id',
        [scope.agencyId, scope.locationId, id]
      );
      return res.rowCount > 0;
    },

    async recordSubmission(tx, input = {}) {
      const scope = assertScope(tx, input.agencyId, input.locationId);
      if (!input.formId) throw new Error('formId is required.');
      const res = await tx.query(
        `INSERT INTO form_submissions (
          id, agency_id, location_id, form_id, contact_id, idempotency_key, answers, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING
        RETURNING *`,
        [
          input.id || randomUUID(),
          scope.agencyId,
          scope.locationId,
          input.formId,
          input.contactId || null,
          input.idempotencyKey || null,
          JSON.stringify(input.answers || {}),
          JSON.stringify(input.metadata || {})
        ]
      );

      if (res.rowCount === 0 && input.idempotencyKey) {
        const existing = await tx.query(
          `SELECT * FROM form_submissions
           WHERE agency_id = $1 AND location_id = $2 AND form_id = $3 AND idempotency_key = $4
           LIMIT 1`,
          [scope.agencyId, scope.locationId, input.formId, input.idempotencyKey]
        );
        return { deduplicated: true, submission: mapSubmissionRow(existing.rows[0]) };
      }

      await tx.query(
        'UPDATE forms SET submissions_count = submissions_count + 1, updated_at = now() WHERE agency_id = $1 AND location_id = $2 AND id = $3',
        [scope.agencyId, scope.locationId, input.formId]
      );

      return { deduplicated: false, submission: mapSubmissionRow(res.rows[0]) };
    },

    async listSubmissions(tx, { agencyId, locationId, formId = null, limit = 100 } = {}) {
      const scope = assertScope(tx, agencyId, locationId);
      const params = [scope.agencyId, scope.locationId];
      const filters = ['agency_id = $1', 'location_id = $2'];
      if (formId) {
        params.push(formId);
        filters.push(`form_id = $${params.length}`);
      }
      params.push(Math.min(500, Math.max(1, Number(limit) || 100)));
      const res = await tx.query(
        `SELECT * FROM form_submissions WHERE ${filters.join(' AND ')} ORDER BY submitted_at DESC LIMIT $${params.length}`,
        params
      );
      return res.rows.map(mapSubmissionRow);
    }
  };
}
