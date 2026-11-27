import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createSites2Repository } from '../../../packages/db/lib/sites-2-repository.mjs';
import { STARTER_TEMPLATES, SITE_COMPONENT_LIBRARY, validatePageSchema } from '../../../packages/platform-core/src/sites-2-0.mjs';

const repo = createSites2Repository();

export async function handleSites2Routes({ req, res, pathname, method, ctx }) {
  if (!pathname.startsWith('/api/sites/v2')) return false;

  const { pgPool, agency, activeLocation, actor, readBody, sendJson } = ctx;
  if (!agency || !activeLocation) {
    sendJson(res, 401, { error: 'Authentication required' });
    return true;
  }

  // Stateless catalog & schema validation work in both PG and JSON modes
  if (method === 'GET' && pathname === '/api/sites/v2/catalog') {
    sendJson(res, 200, { templates: STARTER_TEMPLATES, components: SITE_COMPONENT_LIBRARY });
    return true;
  }

  if (method === 'POST' && pathname === '/api/sites/v2/pages/validate') {
    const body = await readBody(req);
    const check = validatePageSchema(body);
    sendJson(res, check.valid ? 200 : 400, check);
    return true;
  }

  if (!pgPool) {
    sendJson(res, 503, { error: 'PostgreSQL is required for Sites 2.0 persistence', code: 'DATABASE_UNAVAILABLE' });
    return true;
  }

  const tenantCtx = {
    agencyId: agency.id,
    locationId: activeLocation.id,
    actorId: actor?.id || actor?.userId || 'system'
  };

  try {
    if (method === 'GET' && pathname === '/api/sites/v2') {
      const data = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.listSites(tx));
      sendJson(res, 200, { data });
      return true;
    }
    if (method === 'POST' && pathname === '/api/sites/v2') {
      const body = await readBody(req);
      const created = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        repo.createSite(tx, { ...body, createdBy: tenantCtx.actorId })
      );
      sendJson(res, 201, created);
      return true;
    }
    if (method === 'GET' && pathname.endsWith('/pages')) {
      const siteId = pathname.split('/')[4];
      const data = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.listPages(tx, { siteId }));
      sendJson(res, 200, { data });
      return true;
    }
    if (method === 'POST' && pathname.endsWith('/pages')) {
      const siteId = pathname.split('/')[4];
      const body = await readBody(req);
      const saved = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        repo.savePageDraft(tx, { ...body, siteId })
      );
      sendJson(res, 200, saved);
      return true;
    }
    if (method === 'POST' && pathname.endsWith('/publish')) {
      const siteId = pathname.split('/')[4];
      const version = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        repo.publishSite(tx, { siteId, actorId: tenantCtx.actorId })
      );
      sendJson(res, 200, version);
      return true;
    }
    if (method === 'POST' && pathname.endsWith('/rollback')) {
      const siteId = pathname.split('/')[4];
      const body = await readBody(req);
      const version = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        repo.rollbackSite(tx, { siteId, versionNumber: body.versionNumber, actorId: tenantCtx.actorId })
      );
      sendJson(res, 200, version);
      return true;
    }
    if (method === 'POST' && pathname === '/api/sites/v2/events') {
      const body = await readBody(req);
      const result = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.recordConversionEvent(tx, body));
      sendJson(res, result.recorded ? 201 : 200, result);
      return true;
    }
    sendJson(res, 404, { error: 'Sites 2.0 endpoint not found' });
    return true;
  } catch (err) {
    const code = err?.code || 'SITES_ERROR';
    const status = code === 'VERSION_CONFLICT' ? 409 : ['INVALID_PAGE_SLUG', 'PAGE_TITLE_REQUIRED', 'UNKNOWN_COMPONENT_TYPE', 'UNSAFE_PAGE_CONTENT', 'UNSAFE_SEO_META'].includes(code) ? 400 : 500;
    sendJson(res, status, { error: err.message, code });
    return true;
  }
}
