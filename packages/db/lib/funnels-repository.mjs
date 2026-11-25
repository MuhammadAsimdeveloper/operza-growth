/**
 * ============================================================================
 * Operza Funnels & Websites Repository — Domain Boundary
 * ============================================================================
 * Encapsulates all Funnel and Website aggregate persistence logic strictly
 * through TenantTx instances against `location_records` (`collection = 'websites'`),
 * enforcing multi-tenant PostgreSQL Row Level Security (RLS).
 */

import { randomUUID } from 'node:crypto';

const COLLECTION = 'websites';

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeFunnelRow(row) {
  if (!row) return null;
  const body = typeof row.body === 'string' ? JSON.parse(row.body) : (row.body || {});
  return {
    ...body,
    id: row.id,
    agencyId: row.agency_id || row.agencyId || body.agencyId,
    locationId: row.location_id || row.locationId || body.locationId,
    name: body.name || 'Untitled Funnel',
    slug: body.slug || slugify(body.name) || `funnel-${String(row.id).slice(0, 8)}`,
    kind: body.kind || 'funnel',
    published: Boolean(body.published),
    visits: Number(body.visits) || 0,
    optins: Number(body.optins) || 0,
    pages: Array.isArray(body.pages) ? body.pages : [],
    createdAt: row.created_at?.toISOString?.() || row.created_at || body.createdAt,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || body.updatedAt
  };
}

export function createFunnelsRepository() {
  return {
    async createFunnel(tx, data) {
      if (!data || typeof data !== 'object') {
        throw new Error('INVALID_FUNNEL_PAYLOAD: Payload must be an object');
      }
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!name) {
        throw new Error('INVALID_FUNNEL_NAME: Name is required');
      }

      const assignedId = (typeof data.id === 'string' && data.id.trim()) ? data.id.trim() : randomUUID();
      const now = new Date();
      const recordBody = {
        ...data,
        id: assignedId,
        agencyId: tx.agencyId,
        locationId: tx.locationId,
        name,
        slug: (typeof data.slug === 'string' && data.slug.trim()) ? slugify(data.slug) : (slugify(name) || `funnel-${assignedId.slice(0, 8)}`),
        kind: data.kind || 'funnel',
        published: Boolean(data.published),
        visits: Number(data.visits) || 0,
        optins: Number(data.optins) || 0,
        pages: Array.isArray(data.pages) ? data.pages : []
      };

      const res = await tx.query(
        `INSERT INTO location_records (id, agency_id, location_id, collection, body, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         RETURNING *`,
        [assignedId, tx.agencyId, tx.locationId, COLLECTION, JSON.stringify(recordBody), now, now]
      );
      return normalizeFunnelRow(res.rows[0]);
    },

    async getFunnelById(tx, id) {
      if (!id) return null;
      const res = await tx.query(
        `SELECT * FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = $3 AND id = $4`,
        [tx.agencyId, tx.locationId, COLLECTION, id]
      );
      if (res.rows.length === 0) return null;
      return normalizeFunnelRow(res.rows[0]);
    },

    async listFunnels(tx, options = {}) {
      const res = await tx.query(
        `SELECT * FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = $3 ORDER BY updated_at DESC`,
        [tx.agencyId, tx.locationId, COLLECTION]
      );
      let items = res.rows.map(normalizeFunnelRow);
      if (options.kind) {
        items = items.filter(i => i.kind === options.kind);
      }
      if (options.search) {
        const q = String(options.search).toLowerCase();
        items = items.filter(i => i.name.toLowerCase().includes(q) || (i.slug && i.slug.toLowerCase().includes(q)));
      }
      return items;
    },

    async updateFunnel(tx, id, patch) {
      if (!id || !patch || typeof patch !== 'object') return null;
      const existing = await this.getFunnelById(tx, id);
      if (!existing) return null;

      const updatedBody = {
        ...existing,
        ...patch,
        id,
        agencyId: tx.agencyId,
        locationId: tx.locationId,
        updatedAt: new Date().toISOString()
      };

      const res = await tx.query(
        `UPDATE location_records
         SET body = $1::jsonb, updated_at = now()
         WHERE agency_id = $2 AND location_id = $3 AND collection = $4 AND id = $5
         RETURNING *`,
        [JSON.stringify(updatedBody), tx.agencyId, tx.locationId, COLLECTION, id]
      );
      if (res.rows.length === 0) return null;
      return normalizeFunnelRow(res.rows[0]);
    },

    async deleteFunnel(tx, id) {
      if (!id) return false;
      const res = await tx.query(
        `DELETE FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = $3 AND id = $4`,
        [tx.agencyId, tx.locationId, COLLECTION, id]
      );
      return (res.rowCount || 0) > 0;
    },

    async recordVisit(tx, id, pageSlug = null) {
      const existing = await this.getFunnelById(tx, id);
      if (!existing) return null;

      const pages = Array.isArray(existing.pages) ? existing.pages.map(p => ({ ...p })) : [];
      if (pages.length > 0) {
        if (pageSlug) {
          const target = pages.find(p => p.slug === pageSlug || p.path === pageSlug || p.path === `/${pageSlug}`);
          if (target) target.visits = (Number(target.visits) || 0) + 1;
        } else {
          pages[0].visits = (Number(pages[0].visits) || 0) + 1;
        }
      }

      return this.updateFunnel(tx, id, {
        visits: (Number(existing.visits) || 0) + 1,
        pages
      });
    },

    async recordOptin(tx, id, pageSlug = null) {
      const existing = await this.getFunnelById(tx, id);
      if (!existing) return null;

      const pages = Array.isArray(existing.pages) ? existing.pages.map(p => ({ ...p })) : [];
      if (pages.length > 0 && pageSlug) {
        const target = pages.find(p => p.slug === pageSlug || p.path === pageSlug || p.path === `/${pageSlug}`);
        if (target) target.optins = (Number(target.optins) || 0) + 1;
      }

      return this.updateFunnel(tx, id, {
        optins: (Number(existing.optins) || 0) + 1,
        pages
      });
    }
  };
}
