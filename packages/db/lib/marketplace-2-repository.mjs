/**
 * ============================================================================
 * Operza Marketplace 2.0 Repository
 * ============================================================================
 * Separates developer/publisher ownership (`marketplace_publishers`,
 * `marketplace_app_releases`), platform-admin governance (`marketplace_apps`),
 * and TenantTx-isolated workspace installations & verified reviews.
 */

import { randomUUID } from 'node:crypto';
import {
  canTransitionAppStatus,
  checkUpgradeScopeEscalation,
  compareSemver,
  validateAppManifest
} from '../../platform-core/src/marketplace-2-0.mjs';

export function createMarketplace2Repository() {
  return {
    // ── Publisher Portal ─────────────────────────────────────────────────────
    async createPublisher(db, { ownerUserId, displayName, organizationName = '', supportEmail, websiteUrl = null, termsAccepted = true }) {
      if (!ownerUserId || !displayName || !supportEmail) {
        throw Object.assign(new TypeError('Publisher ownerUserId, displayName, and supportEmail are required'), { code: 'INVALID_PUBLISHER' });
      }
      if (!termsAccepted) {
        throw Object.assign(new Error('Developer terms must be accepted'), { code: 'TERMS_REQUIRED' });
      }
      const res = await db.query(
        `INSERT INTO marketplace_publishers (
          id, owner_user_id, display_name, organization_name, support_email, website_url, terms_accepted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, now())
        RETURNING *`,
        [randomUUID(), String(ownerUserId), displayName.trim(), organizationName.trim(), supportEmail.trim(), websiteUrl]
      );
      return res.rows[0];
    },

    async listPublishersForOwner(db, ownerUserId) {
      const res = await db.query(
        `SELECT * FROM marketplace_publishers WHERE owner_user_id = $1 ORDER BY created_at DESC`,
        [String(ownerUserId)]
      );
      return res.rows;
    },

    async createDraftApp(db, { publisherId, ownerUserId, manifest }) {
      const pubRes = await db.query(`SELECT * FROM marketplace_publishers WHERE id = $1`, [publisherId]);
      const pub = pubRes.rows[0];
      if (!pub || String(pub.owner_user_id) !== String(ownerUserId)) {
        throw Object.assign(new Error('Publisher ownership mismatch'), { code: 'PUBLISHER_FORBIDDEN', status: 403 });
      }
      const validation = validateAppManifest(manifest);
      if (!validation.valid) {
        throw Object.assign(new Error('Manifest validation failed'), { code: 'INVALID_MANIFEST', status: 400, errors: validation.errors });
      }
      const appId = randomUUID();
      const res = await db.query(
        `INSERT INTO marketplace_apps (
          id, slug, name, description, publisher_id, category, app_type,
          status, version, requested_scopes, manifest, pricing_model, price_cents, currency
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9::jsonb, $10::jsonb, $11, $12, $13)
        RETURNING *`,
        [
          appId,
          manifest.slug.toLowerCase(),
          manifest.name.trim(),
          manifest.description || '',
          publisherId,
          manifest.category || 'automation',
          manifest.appType,
          manifest.version,
          JSON.stringify(manifest.requestedScopes || []),
          JSON.stringify(manifest),
          manifest.pricingModel || 'free',
          manifest.priceCents ?? 0,
          (manifest.currency || 'usd').toLowerCase()
        ]
      );
      await db.query(
        `INSERT INTO marketplace_app_releases (
          id, app_id, version, release_channel, compatibility_min, release_notes, requested_scopes, manifest
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
        [
          randomUUID(), appId, manifest.version, manifest.releaseChannel || 'stable',
          manifest.compatibilityMin || '2.0.0', manifest.releaseNotes || '',
          JSON.stringify(manifest.requestedScopes || []), JSON.stringify(manifest)
        ]
      );
      return res.rows[0];
    },

    async submitAppForReview(db, { appId, ownerUserId }) {
      const appRes = await db.query(
        `SELECT a.*, p.owner_user_id FROM marketplace_apps a JOIN marketplace_publishers p ON p.id::text = a.publisher_id WHERE a.id = $1`,
        [appId]
      );
      const app = appRes.rows[0];
      if (!app || String(app.owner_user_id) !== String(ownerUserId)) {
        throw Object.assign(new Error('App not found or unauthorized'), { code: 'PUBLISHER_FORBIDDEN', status: 403 });
      }
      if (!canTransitionAppStatus(app.status, 'submitted')) {
        throw Object.assign(new Error(`Cannot submit app from status '${app.status}'`), { code: 'INVALID_TRANSITION', status: 400 });
      }
      const res = await db.query(
        `UPDATE marketplace_apps SET status = 'submitted', updated_at = now() WHERE id = $1 RETURNING *`,
        [appId]
      );
      return res.rows[0];
    },

    async submitNewVersion(db, { appId, ownerUserId, manifest }) {
      const appRes = await db.query(
        `SELECT a.*, p.owner_user_id FROM marketplace_apps a JOIN marketplace_publishers p ON p.id::text = a.publisher_id WHERE a.id = $1`,
        [appId]
      );
      const app = appRes.rows[0];
      if (!app || String(app.owner_user_id) !== String(ownerUserId)) {
        throw Object.assign(new Error('App not found or unauthorized'), { code: 'PUBLISHER_FORBIDDEN', status: 403 });
      }
      const validation = validateAppManifest({ ...manifest, slug: app.slug });
      if (!validation.valid) {
        throw Object.assign(new Error('Manifest validation failed'), { code: 'INVALID_MANIFEST', status: 400, errors: validation.errors });
      }
      if (compareSemver(manifest.version, app.version) <= 0) {
        throw Object.assign(new Error(`Version ${manifest.version} must be greater than ${app.version}`), { code: 'VERSION_DOWNGRADE_FORBIDDEN', status: 400 });
      }
      const rel = await db.query(
        `INSERT INTO marketplace_app_releases (
          id, app_id, version, release_channel, compatibility_min, release_notes, requested_scopes, manifest, security_review_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'pending')
        RETURNING *`,
        [
          randomUUID(), appId, manifest.version, manifest.releaseChannel || 'stable',
          manifest.compatibilityMin || '2.0.0', manifest.releaseNotes || '',
          JSON.stringify(manifest.requestedScopes || []), JSON.stringify(manifest)
        ]
      );
      return rel.rows[0];
    },

    // ── Platform Admin Governance ────────────────────────────────────────────
    async adminTransitionApp(db, { appId, toStatus, actorId, reason = '' }) {
      const appRes = await db.query(`SELECT * FROM marketplace_apps WHERE id = $1`, [appId]);
      const app = appRes.rows[0];
      if (!app) {
        throw Object.assign(new Error('App not found'), { code: 'APP_NOT_FOUND', status: 404 });
      }
      if (!canTransitionAppStatus(app.status, toStatus)) {
        throw Object.assign(new Error(`Invalid transition ${app.status} -> ${toStatus}`), { code: 'INVALID_TRANSITION', status: 400 });
      }
      const updated = await db.query(
        `UPDATE marketplace_apps SET status = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
        [appId, toStatus, actorId]
      );
      await db.query(
        `UPDATE marketplace_app_releases
         SET security_review_status = CASE WHEN $2 IN ('approved', 'published') THEN 'approved' WHEN $2 = 'rejected' THEN 'rejected' ELSE security_review_status END,
             reviewed_by = $3,
             published_at = CASE WHEN $2 = 'published' THEN now() ELSE published_at END
         WHERE app_id = $1 AND version = $4`,
        [appId, toStatus, actorId, app.version]
      );
      await db.query(
        `INSERT INTO platform_admin_audit_log (actor_id, action, target_type, target_id, reason) VALUES ($1, $2, 'marketplace_app', $3, $4)`,
        [actorId, `marketplace.app.${toStatus}`, appId, reason]
      );
      return updated.rows[0];
    },

    // ── Tenant Installation, Upgrade & Revocation (TenantTx) ─────────────────
    async upgradeInstallation(tx, { installationId, targetVersion, consentUpgraded = false }) {
      const instRes = await tx.query(
        `SELECT * FROM marketplace_installations WHERE agency_id = $1 AND location_id = $2 AND id = $3 FOR UPDATE`,
        [tx.agencyId, tx.locationId, installationId]
      );
      const inst = instRes.rows[0];
      if (!inst) {
        throw Object.assign(new Error('Installation not found'), { code: 'INSTALLATION_NOT_FOUND', status: 404 });
      }
      const relRes = await tx.query(
        `SELECT * FROM marketplace_app_releases WHERE app_id = $1 AND version = $2 AND security_review_status = 'approved'`,
        [inst.app_id, targetVersion]
      );
      const rel = relRes.rows[0];
      if (!rel) {
        throw Object.assign(new Error('Approved release version not found'), { code: 'RELEASE_NOT_APPROVED', status: 400 });
      }
      const currentGranted = Array.isArray(inst.granted_scopes) ? inst.granted_scopes : [];
      const nextRequested = Array.isArray(rel.requested_scopes) ? rel.requested_scopes : [];
      const esc = checkUpgradeScopeEscalation({ currentGrantedScopes: currentGranted, nextRequestedScopes: nextRequested });
      if (esc.requiresRenewedConsent && !consentUpgraded) {
        throw Object.assign(new Error(`Upgrade requires renewed consent for scopes: ${esc.newlyRequestedScopes.join(', ')}`), {
          code: 'PERMISSION_UPGRADE_CONSENT_REQUIRED',
          status: 409,
          newlyRequestedScopes: esc.newlyRequestedScopes
        });
      }
      const updated = await tx.query(
        `UPDATE marketplace_installations
         SET installed_version = $1,
             granted_scopes = $2::jsonb,
             consent_upgraded_at = CASE WHEN $3 THEN now() ELSE consent_upgraded_at END,
             updated_at = now()
         WHERE agency_id = $4 AND location_id = $5 AND id = $6
         RETURNING *`,
        [targetVersion, JSON.stringify(nextRequested), consentUpgraded, tx.agencyId, tx.locationId, installationId]
      );
      return updated.rows[0];
    },

    // ── Verified Reviews (TenantTx + FORCE RLS) ──────────────────────────────
    async submitReview(tx, { appId, reviewerUserId, rating, body = '' }) {
      const instRes = await tx.query(
        `SELECT id FROM marketplace_installations
         WHERE agency_id = $1 AND location_id = $2 AND app_id = $3 AND status IN ('installed', 'configured', 'connected', 'active')
         LIMIT 1`,
        [tx.agencyId, tx.locationId, appId]
      );
      if (instRes.rows.length === 0) {
        throw Object.assign(new Error('Only tenants with an active installation may submit a review'), { code: 'VERIFIED_INSTALL_REQUIRED', status: 403 });
      }
      const pubCheck = await tx.query(
        `SELECT 1 FROM marketplace_apps a JOIN marketplace_publishers p ON p.id::text = a.publisher_id WHERE a.id = $1 AND p.owner_user_id = $2`,
        [appId, String(reviewerUserId)]
      );
      if (pubCheck.rows.length > 0) {
        throw Object.assign(new Error('Publishers cannot review their own applications'), { code: 'SELF_REVIEW_FORBIDDEN', status: 403 });
      }
      const res = await tx.query(
        `INSERT INTO marketplace_app_reviews (
          id, agency_id, location_id, app_id, installation_id, reviewer_user_id, rating, body, verified_installation
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
        RETURNING *`,
        [randomUUID(), tx.agencyId, tx.locationId, appId, instRes.rows[0].id, String(reviewerUserId), rating, body]
      );
      return res.rows[0];
    },

    // ── Publisher Analytics (Strictly Owner-Scoped) ──────────────────────────
    async getPublisherAnalytics(db, { publisherId, ownerUserId }) {
      const pubRes = await db.query(`SELECT * FROM marketplace_publishers WHERE id = $1`, [publisherId]);
      const pub = pubRes.rows[0];
      if (!pub || String(pub.owner_user_id) !== String(ownerUserId)) {
        throw Object.assign(new Error('Publisher access denied'), { code: 'PUBLISHER_FORBIDDEN', status: 403 });
      }
      const res = await db.query(
        `SELECT
           COUNT(DISTINCT a.id)::int AS app_count,
           COUNT(e.id) FILTER (WHERE e.event_type = 'listing_view')::int AS listing_views,
           COUNT(e.id) FILTER (WHERE e.event_type = 'install_success')::int AS install_count,
           COUNT(e.id) FILTER (WHERE e.event_type = 'execution_error')::int AS error_count
         FROM marketplace_apps a
         LEFT JOIN marketplace_analytics_events e ON e.app_id = a.id
         WHERE a.publisher_id = $1`,
        [publisherId]
      );
      return res.rows[0];
    }
  };
}
