/**
 * ============================================================================
 * Operza Marketplace & Developer Ecosystem 2.0 Router
 * ============================================================================
 */

import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createMarketplace2Repository } from '../../../packages/db/lib/marketplace-2-repository.mjs';
import { validateAppManifest } from '../../../packages/platform-core/src/marketplace-2-0.mjs';
import { isPlatformAdminActor } from '../../../packages/platform-core/src/security/route-authz.mjs';

const market2Repo = createMarketplace2Repository();

export async function handleMarketplace2Routes(req, res, ctx) {
  const { method, pathname, actor, agency, activeLocation, pgPool, readBody, sendJson } = ctx;

  const isM2 =
    pathname.startsWith('/api/marketplace/v2/') ||
    pathname.startsWith('/api/developer/') ||
    pathname.startsWith('/api/platform-admin/marketplace/v2/');

  if (!isM2) return false;

  if (!pgPool) {
    if (method === 'GET' && pathname === '/api/marketplace/v2/catalog') {
      sendJson(res, 200, { apps: [] });
      return true;
    }
    sendJson(res, 503, { error: 'PostgreSQL required for Marketplace 2.0 routes', code: 'PG_REQUIRED' });
    return true;
  }

  const userId = actor?.user?.id || actor?.id || 'system';
  const tenantCtx = { agencyId: agency?.id, locationId: activeLocation?.id, actorId: userId };

  // Public/Tenant Catalog Search
  if (method === 'GET' && pathname === '/api/marketplace/v2/catalog') {
    const apps = await pgPool.query(
      `SELECT id, slug, name, description, publisher_id, category, app_type, status, version, requested_scopes, pricing_model, price_cents, currency, updated_at
       FROM marketplace_apps WHERE status IN ('approved', 'published') ORDER BY updated_at DESC`
    );
    sendJson(res, 200, { apps: apps.rows });
    return true;
  }

  // Developer Portal: Publishers & Draft Apps
  if (pathname === '/api/developer/publishers') {
    if (method === 'GET') {
      const publishers = await market2Repo.listPublishersForOwner(pgPool, userId);
      sendJson(res, 200, { publishers });
      return true;
    }
    if (method === 'POST') {
      const body = await readBody(req);
      try {
        const pub = await market2Repo.createPublisher(pgPool, { ...body, ownerUserId: userId });
        sendJson(res, 201, { publisher: pub });
      } catch (err) {
        sendJson(res, err.status || 400, { error: err.message, code: err.code || 'PUBLISHER_ERROR' });
      }
      return true;
    }
  }

  if (method === 'POST' && pathname === '/api/developer/manifests/validate') {
    const body = await readBody(req);
    sendJson(res, 200, validateAppManifest(body?.manifest || body || {}));
    return true;
  }

  if (method === 'POST' && pathname === '/api/developer/apps') {
    const body = await readBody(req);
    try {
      const app = await market2Repo.createDraftApp(pgPool, {
        publisherId: body?.publisherId,
        ownerUserId: userId,
        manifest: body?.manifest || {}
      });
      sendJson(res, 201, { app });
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.message, code: err.code || 'APP_CREATE_FAILED', errors: err.errors });
    }
    return true;
  }

  const submitMatch = pathname.match(/^\/api\/developer\/apps\/([^/]+)\/submit$/);
  if (method === 'POST' && submitMatch) {
    try {
      const app = await market2Repo.submitAppForReview(pgPool, { appId: submitMatch[1], ownerUserId: userId });
      sendJson(res, 200, { app });
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.message, code: err.code || 'SUBMIT_FAILED' });
    }
    return true;
  }

  const analyticsMatch = pathname.match(/^\/api\/developer\/publishers\/([^/]+)\/analytics$/);
  if (method === 'GET' && analyticsMatch) {
    try {
      const analytics = await market2Repo.getPublisherAnalytics(pgPool, { publisherId: analyticsMatch[1], ownerUserId: userId });
      sendJson(res, 200, { analytics });
    } catch (err) {
      sendJson(res, err.status || 403, { error: err.message, code: err.code || 'PUBLISHER_FORBIDDEN' });
    }
    return true;
  }

  // Platform Admin Governance
  const adminMatch = pathname.match(/^\/api\/platform-admin\/marketplace\/v2\/([^/]+)\/transition$/);
  if (method === 'POST' && adminMatch) {
    if (!isPlatformAdminActor(actor)) {
      sendJson(res, 403, { error: 'Platform administrator privilege required', code: 'PLATFORM_ADMIN_REQUIRED' });
      return true;
    }
    const body = await readBody(req);
    try {
      const app = await market2Repo.adminTransitionApp(pgPool, {
        appId: adminMatch[1],
        toStatus: body?.status,
        actorId: userId,
        reason: body?.reason || ''
      });
      sendJson(res, 200, { app });
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.message, code: err.code || 'ADMIN_TRANSITION_FAILED' });
    }
    return true;
  }

  // Tenant Upgrade & Verified Reviews
  if (method === 'POST' && pathname === '/api/marketplace/v2/installations/upgrade') {
    const body = await readBody(req);
    try {
      const inst = await runInTenantTx(pgPool, tenantCtx, tx => market2Repo.upgradeInstallation(tx, body || {}));
      sendJson(res, 200, { installation: inst });
    } catch (err) {
      sendJson(res, err.status || 400, {
        error: err.message,
        code: err.code || 'UPGRADE_FAILED',
        newlyRequestedScopes: err.newlyRequestedScopes
      });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/marketplace/v2/reviews') {
    const body = await readBody(req);
    try {
      const review = await runInTenantTx(pgPool, tenantCtx, tx =>
        market2Repo.submitReview(tx, { ...body, reviewerUserId: userId })
      );
      sendJson(res, 201, { review });
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.message, code: err.code || 'REVIEW_FAILED' });
    }
    return true;
  }

  return false;
}
