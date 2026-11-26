/**
 * Phase 6 — Site & Funnel Immutable Version Repository (TenantTx)
 * Separates draft edits from published customer-facing versions and supports rollback.
 */

import { randomUUID } from 'node:crypto';

export function createSiteVersionsRepository() {
  return {
    async saveDraft(tx, { siteId, snapshot = {}, seoMeta = {} } = {}) {
      const latest = await tx.query(
        `SELECT COALESCE(MAX(version_number), 0)::int AS max_ver
         FROM site_versions WHERE agency_id = $1 AND location_id = $2 AND site_id = $3`,
        [tx.agencyId, tx.locationId, siteId]
      );
      const nextVersion = Number(latest.rows[0]?.max_ver || 0) + 1;
      const res = await tx.query(
        `INSERT INTO site_versions (
          agency_id, location_id, id, site_id, version_number, status, snapshot, seo_meta
        ) VALUES ($1, $2, $3, $4, $5, 'draft', $6::jsonb, $7::jsonb)
        RETURNING *`,
        [tx.agencyId, tx.locationId, randomUUID(), siteId, nextVersion, JSON.stringify(snapshot), JSON.stringify(seoMeta)]
      );
      return res.rows[0];
    },

    async publishVersion(tx, { siteId, snapshot = {}, seoMeta = {}, actorId = null } = {}) {
      // Archive any currently published version without deleting history
      await tx.query(
        `UPDATE site_versions
         SET status = 'archived'
         WHERE agency_id = $1 AND location_id = $2 AND site_id = $3 AND status = 'published'`,
        [tx.agencyId, tx.locationId, siteId]
      );

      const latest = await tx.query(
        `SELECT COALESCE(MAX(version_number), 0)::int AS max_ver
         FROM site_versions WHERE agency_id = $1 AND location_id = $2 AND site_id = $3`,
        [tx.agencyId, tx.locationId, siteId]
      );
      const nextVersion = Number(latest.rows[0]?.max_ver || 0) + 1;

      const res = await tx.query(
        `INSERT INTO site_versions (
          agency_id, location_id, id, site_id, version_number, status,
          snapshot, seo_meta, published_by, published_at
        ) VALUES ($1, $2, $3, $4, $5, 'published', $6::jsonb, $7::jsonb, $8, now())
        RETURNING *`,
        [
          tx.agencyId,
          tx.locationId,
          randomUUID(),
          siteId,
          nextVersion,
          JSON.stringify(snapshot),
          JSON.stringify(seoMeta),
          actorId
        ]
      );
      return res.rows[0];
    },

    async getPublishedVersion(tx, siteId) {
      const res = await tx.query(
        `SELECT * FROM site_versions
         WHERE agency_id = $1 AND location_id = $2 AND site_id = $3 AND status = 'published'
         ORDER BY version_number DESC LIMIT 1`,
        [tx.agencyId, tx.locationId, siteId]
      );
      return res.rows[0] || null;
    },

    async listVersions(tx, siteId) {
      const res = await tx.query(
        `SELECT * FROM site_versions
         WHERE agency_id = $1 AND location_id = $2 AND site_id = $3
         ORDER BY version_number DESC`,
        [tx.agencyId, tx.locationId, siteId]
      );
      return res.rows;
    },

    async rollbackToVersion(tx, { siteId, versionNumber, actorId = null } = {}) {
      const targetRes = await tx.query(
        `SELECT * FROM site_versions
         WHERE agency_id = $1 AND location_id = $2 AND site_id = $3 AND version_number = $4`,
        [tx.agencyId, tx.locationId, siteId, Number(versionNumber)]
      );
      if (targetRes.rows.length === 0) {
        throw Object.assign(new Error(`Version ${versionNumber} not found`), { code: 'VERSION_NOT_FOUND' });
      }
      const target = targetRes.rows[0];
      return this.publishVersion(tx, {
        siteId,
        snapshot: target.snapshot,
        seoMeta: target.seo_meta,
        actorId
      });
    }
  };
}
