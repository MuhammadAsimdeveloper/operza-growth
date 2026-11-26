/**
 * Phase 7 — Marketplace Catalog & Tenant Installation Repository
 * Separates platform-admin app review/publication (`marketplace_apps`) from
 * TenantTx-isolated workspace installations (`marketplace_installations`).
 */

import { randomUUID } from 'node:crypto';

export function createMarketplaceRepository() {
  return {
    // Platform-admin catalog operations (run outside tenant RLS or by platform admin)
    async submitApp(db, {
      id = randomUUID(),
      slug,
      name,
      publisherId,
      category = 'automation',
      version = '1.0.0',
      connectorId = null,
      requestedScopes = [],
      manifest = {}
    } = {}) {
      const res = await db.query(
        `INSERT INTO marketplace_apps (
          id, slug, name, publisher_id, category, status, version, connector_id, requested_scopes, manifest
        ) VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7, $8::jsonb, $9::jsonb)
        RETURNING *`,
        [
          id,
          String(slug).toLowerCase().trim(),
          name.trim(),
          publisherId,
          category,
          version,
          connectorId,
          JSON.stringify(requestedScopes),
          JSON.stringify(manifest)
        ]
      );
      return res.rows[0];
    },

    async reviewApp(db, appId, { status, reviewedBy } = {}) {
      if (!['under_review', 'approved', 'published', 'suspended', 'deprecated', 'removed'].includes(status)) {
        throw Object.assign(new TypeError(`Invalid marketplace review status: ${status}`), { code: 'INVALID_APP_STATUS' });
      }
      const res = await db.query(
        `UPDATE marketplace_apps
         SET status = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [appId, status, reviewedBy]
      );
      return res.rows[0] || null;
    },

    async listPublishedApps(db, { category = null } = {}) {
      if (category) {
        const res = await db.query(
          `SELECT * FROM marketplace_apps WHERE status IN ('approved', 'published') AND category = $1 ORDER BY name ASC`,
          [category]
        );
        return res.rows;
      }
      const res = await db.query(
        `SELECT * FROM marketplace_apps WHERE status IN ('approved', 'published') ORDER BY name ASC`
      );
      return res.rows;
    },

    // Tenant-scoped installation operations (strictly via TenantTx)
    async installApp(tx, { appId, installedBy, grantedScopes = [], connectionId = null } = {}) {
      const appRes = await tx.query(`SELECT * FROM marketplace_apps WHERE id = $1`, [appId]);
      const app = appRes.rows[0];
      if (!app) {
        throw Object.assign(new Error('Marketplace app not found'), { code: 'APP_NOT_FOUND' });
      }
      if (!['approved', 'published'].includes(app.status)) {
        throw Object.assign(new Error(`Marketplace app '${app.slug}' is not approved for installation`), {
          code: 'APP_NOT_APPROVED'
        });
      }

      const requested = Array.isArray(app.requested_scopes) ? app.requested_scopes : [];
      const invalidScopes = grantedScopes.filter((s) => !requested.includes(s));
      if (invalidScopes.length > 0) {
        throw Object.assign(new Error(`Cannot grant undeclared scopes: ${invalidScopes.join(', ')}`), {
          code: 'INVALID_GRANTED_SCOPES'
        });
      }

      const res = await tx.query(
        `INSERT INTO marketplace_installations (
          agency_id, location_id, id, app_id, installed_by, granted_scopes, status, connection_id
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'installed', $7)
        RETURNING *`,
        [tx.agencyId, tx.locationId, randomUUID(), appId, installedBy, JSON.stringify(grantedScopes), connectionId]
      );
      return res.rows[0];
    },

    async listInstallations(tx) {
      const res = await tx.query(
        `SELECT i.*, a.slug AS app_slug, a.name AS app_name, a.status AS app_status, a.connector_id
         FROM marketplace_installations i
         JOIN marketplace_apps a ON a.id = i.app_id
         WHERE i.agency_id = $1 AND i.location_id = $2
         ORDER BY i.installed_at DESC`,
        [tx.agencyId, tx.locationId]
      );
      return res.rows;
    },

    async uninstallApp(tx, installationId) {
      const res = await tx.query(
        `UPDATE marketplace_installations
         SET status = 'uninstalled', connection_id = NULL, uninstalled_at = now(), updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [tx.agencyId, tx.locationId, installationId]
      );
      return res.rows[0] || null;
    }
  };
}
