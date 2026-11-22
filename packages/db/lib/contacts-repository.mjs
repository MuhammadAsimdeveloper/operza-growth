/**
 * ============================================================================
 * Operza Contacts Repository — Domain Boundary
 * ============================================================================
 * Encapsulates all contact aggregate persistence logic strictly through
 * TenantTx instances, enforcing multi-tenant PostgreSQL Row Level Security (RLS).
 */

import { randomUUID } from 'node:crypto';

/**
 * Normalizes a database row from location_records into a clean Contact entity.
 *
 * @param {any} row
 * @returns {any}
 */
function normalizeContactRow(row) {
  if (!row) return null;
  const body = (typeof row.body === 'string') ? JSON.parse(row.body) : (row.body || {});
  return {
    ...body,
    id: row.id,
    agencyId: row.agency_id || row.agencyId,
    locationId: row.location_id || row.locationId,
    createdAt: row.created_at?.toISOString?.() || row.created_at || body.createdAt,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || body.updatedAt
  };
}

/**
 * Creates an instance of ContactsRepository.
 *
 * @returns {any}
 */
export function createContactsRepository() {
  const COLLECTION = 'contacts';

  return {
    /**
     * Creates a new contact within the tenant transaction.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {any} data
     * @returns {Promise<any>}
     */
    async create(tx, data) {
      const assignedId = (typeof data?.id === 'string' && data.id.trim()) ? data.id.trim() : randomUUID();
      const now = new Date().toISOString();

      // Defensive copy & strip forbidden tenant ID injection
      const payload = { ...data };
      delete payload.id;
      delete payload.agencyId;
      delete payload.locationId;

      const contactEntity = {
        firstName: payload.firstName || '',
        lastName: payload.lastName || '',
        email: payload.email || '',
        phone: payload.phone || '',
        company: payload.company || '',
        source: payload.source || 'manual',
        tags: Array.isArray(payload.tags) ? payload.tags : [],
        status: payload.status || 'lead',
        leadScore: Number(payload.leadScore) || 0,
        notes: payload.notes || '',
        customFields: payload.customFields || {},
        portalAccess: Boolean(payload.portalAccess),
        ...payload,
        id: assignedId,
        agencyId: tx.agencyId,
        locationId: tx.locationId,
        createdAt: payload.createdAt || now,
        updatedAt: now
      };

      const res = await tx.query(`
        INSERT INTO location_records (id, agency_id, location_id, collection, body, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
        ON CONFLICT (agency_id, location_id, collection, id) DO UPDATE SET
          body = EXCLUDED.body,
          updated_at = EXCLUDED.updated_at
        RETURNING id, agency_id, location_id, body, created_at, updated_at
      `, [
        assignedId,
        tx.agencyId,
        tx.locationId,
        COLLECTION,
        JSON.stringify(contactEntity),
        contactEntity.createdAt,
        contactEntity.updatedAt
      ]);

      const insertedRow = res.rows?.[0];
      return insertedRow ? normalizeContactRow(insertedRow) : contactEntity;
    },

    /**
     * Retrieves a contact by ID strictly within the tenant transaction context.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @returns {Promise<any|null>}
     */
    async getById(tx, id) {
      if (!id || typeof id !== 'string') return null;

      const res = await tx.query(`
        SELECT id, agency_id, location_id, body, created_at, updated_at
        FROM location_records
        WHERE agency_id = $1 AND location_id = $2 AND id = $3 AND collection = $4
      `, [tx.agencyId, tx.locationId, id.trim(), COLLECTION]);

      if (!res.rows || res.rows.length === 0) return null;
      return normalizeContactRow(res.rows[0]);
    },

    /**
     * Lists contacts with search, tag/status filters, sorting, and pagination.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {any} [options]
     * @returns {Promise<{ data: any[], pagination: any }>}
     */
    async list(tx, options = {}) {
      const res = await tx.query(`
        SELECT id, agency_id, location_id, body, created_at, updated_at
        FROM location_records
        WHERE agency_id = $1 AND location_id = $2 AND collection = $3
        ORDER BY updated_at DESC
      `, [tx.agencyId, tx.locationId, COLLECTION]);

      let items = (res.rows || []).map(normalizeContactRow);

      // Search across all text fields
      const search = options.search || options.q;
      if (search) {
        const q = String(search).toLowerCase();
        items = items.filter(c =>
          [c.firstName, c.lastName, c.email, c.phone, c.company, ...(c.tags || [])]
            .some(val => String(val || '').toLowerCase().includes(q))
        );
      }

      // Filter by tag
      if (options.tag) {
        const targetTag = String(options.tag).toLowerCase();
        items = items.filter(c =>
          Array.isArray(c.tags) && c.tags.some(t => String(t).toLowerCase() === targetTag)
        );
      }

      // Filter by status
      if (options.status) {
        const targetStatus = String(options.status).toLowerCase();
        items = items.filter(c =>
          c.status && String(c.status).toLowerCase() === targetStatus
        );
      }

      // Sorting
      const sortField = options.sort || 'createdAt';
      const sortOrder = options.order === 'asc' ? 'asc' : 'desc';
      items.sort((a, b) => {
        const aVal = a[sortField] ?? '';
        const bVal = b[sortField] ?? '';
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const cmp = String(aVal).localeCompare(String(bVal));
        return sortOrder === 'asc' ? cmp : -cmp;
      });

      const total = items.length;
      const page = Math.max(1, Number(options.page) || 1);
      const limit = Math.min(200, Math.max(1, Number(options.limit) || 25));
      const startIdx = (page - 1) * limit;
      const pageData = items.slice(startIdx, startIdx + limit);
      const totalPages = Math.ceil(total / limit);

      return {
        data: pageData,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasMore: page < totalPages
        }
      };
    },

    /**
     * Updates an existing contact within the tenant transaction.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @param {any} patch
     * @returns {Promise<any|null>}
     */
    async update(tx, id, patch) {
      const existing = await this.getById(tx, id);
      if (!existing) return null;

      const payload = { ...patch };
      delete payload.id;
      delete payload.agencyId;
      delete payload.locationId;
      delete payload.createdAt;

      const updatedEntity = {
        ...existing,
        ...payload,
        id: existing.id,
        agencyId: tx.agencyId,
        locationId: tx.locationId,
        updatedAt: new Date().toISOString()
      };

      const res = await tx.query(`
        UPDATE location_records
        SET body = $1::jsonb, updated_at = $2
        WHERE id = $3 AND agency_id = $4 AND location_id = $5 AND collection = $6
        RETURNING id, agency_id, location_id, body, created_at, updated_at
      `, [
        JSON.stringify(updatedEntity),
        updatedEntity.updatedAt,
        existing.id,
        tx.agencyId,
        tx.locationId,
        COLLECTION
      ]);

      const updatedRow = res.rows?.[0];
      return updatedRow ? normalizeContactRow(updatedRow) : updatedEntity;
    },

    /**
     * Deletes a contact by ID within the tenant transaction.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async delete(tx, id) {
      if (!id || typeof id !== 'string') return false;

      const res = await tx.query(`
        DELETE FROM location_records
        WHERE id = $1 AND agency_id = $2 AND location_id = $3 AND collection = $4
      `, [id.trim(), tx.agencyId, tx.locationId, COLLECTION]);

      return Boolean(res.rowCount && res.rowCount > 0);
    },

    /**
     * Bulk tags a list of contacts.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {{ contactIds: string[], tag: string }} params
     * @returns {Promise<number>}
     */
    async bulkTag(tx, { contactIds, tag }) {
      if (!Array.isArray(contactIds) || !tag) return 0;
      let count = 0;
      for (const id of contactIds) {
        const contact = await this.getById(tx, id);
        if (contact) {
          const currentTags = Array.isArray(contact.tags) ? contact.tags : [];
          if (!currentTags.includes(tag)) {
            await this.update(tx, id, { tags: [...currentTags, tag] });
            count++;
          }
        }
      }
      return count;
    }
  };
}
