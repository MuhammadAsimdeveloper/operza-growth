/**
 * Phase 6 — Custom Domains, SSL Lifecycle & Public Host SSR Routes
 * Enforces TenantTx domain ownership, DNS TXT verification, SSL provisioning,
 * and verified-host-only public SSR rendering.
 */

import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createCustomDomainsRepository } from '../../../packages/db/lib/custom-domains-repository.mjs';
import { createSiteVersionsRepository } from '../../../packages/db/lib/site-versions-repository.mjs';
import { createSslProvisioningAdapter, resolvePublicHost } from '../../../packages/platform-core/src/domains/custom-domains.mjs';
import {
  renderPublishedSiteHtml,
  generateTenantSitemapXml,
  generateTenantRobotsTxt,
  createPublicPageCache
} from '../../../packages/platform-core/src/sites/ssr-renderer.mjs';

const domainsRepo = createCustomDomainsRepository();
const versionsRepo = createSiteVersionsRepository();
const pageCache = createPublicPageCache();

export function createDomainsRoutes({
  pgPool = null,
  sslAdapter = createSslProvisioningAdapter(),
  resolveTxt = undefined,
  sendJson,
  readBody,
  auditLog
} = {}) {
  return async function handleDomainsRoute({ method, pathname, req, res, agency, activeLocation, actor }) {
    if (!pgPool) {
      if (pathname.startsWith('/api/domains')) {
        return sendJson(res, 503, { error: 'PostgreSQL is required for custom domain lifecycle', code: 'PG_REQUIRED' });
      }
      return false;
    }

    const tenantCtx = {
      agencyId: agency?.id,
      locationId: activeLocation?.id,
      actorId: actor?.user?.id || actor?.id || 'system'
    };

    if (method === 'GET' && pathname === '/api/domains') {
      const domains = await runInTenantTx(pgPool, tenantCtx, (tx) => domainsRepo.listDomains(tx));
      return sendJson(res, 200, { domains });
    }

    if (method === 'POST' && pathname === '/api/domains') {
      const body = await readBody(req);
      try {
        const domain = await runInTenantTx(pgPool, tenantCtx, (tx) =>
          domainsRepo.requestDomain(tx, {
            siteId: body?.siteId || null,
            hostname: body?.hostname,
            isPrimary: Boolean(body?.isPrimary)
          })
        );
        auditLog?.('domain.requested', actor, { domainId: domain.id, hostname: domain.hostname });
        return sendJson(res, 201, { domain });
      } catch (err) {
        const status = err?.code === 'DOMAIN_ALREADY_CLAIMED' ? 409 : 400;
        return sendJson(res, status, { error: err.message, code: err.code || 'DOMAIN_REQUEST_FAILED' });
      }
    }

    if (method === 'POST' && pathname.startsWith('/api/domains/') && pathname.endsWith('/verify')) {
      const domainId = pathname.replace('/api/domains/', '').replace('/verify', '').trim();
      try {
        const result = await runInTenantTx(pgPool, tenantCtx, (tx) =>
          domainsRepo.verifyDomain(tx, domainId, { resolveTxt })
        );
        if (!result.verified) {
          return sendJson(res, 422, { verified: false, code: result.code, error: result.reason });
        }
        auditLog?.('domain.verified', actor, { domainId, hostname: result.domain.hostname });
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 404, { error: err.message, code: err.code || 'DOMAIN_NOT_FOUND' });
      }
    }

    if (method === 'POST' && pathname.startsWith('/api/domains/') && pathname.endsWith('/ssl')) {
      const domainId = pathname.replace('/api/domains/', '').replace('/ssl', '').trim();
      try {
        const result = await runInTenantTx(pgPool, tenantCtx, (tx) =>
          domainsRepo.provisionSsl(tx, domainId, { sslAdapter })
        );
        if (!result.ok) {
          return sendJson(res, 422, result);
        }
        pageCache.invalidateHost(result.domain.hostname);
        auditLog?.('domain.ssl_active', actor, { domainId, hostname: result.domain.hostname });
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { error: err.message, code: err.code || 'SSL_PROVISION_FAILED' });
      }
    }

    if (method === 'DELETE' && pathname.startsWith('/api/domains/')) {
      const domainId = pathname.replace('/api/domains/', '').trim();
      const removed = await runInTenantTx(pgPool, tenantCtx, (tx) => domainsRepo.disconnectDomain(tx, domainId));
      if (!removed) return sendJson(res, 404, { error: 'Domain not found' });
      pageCache.invalidateHost(removed.hostname);
      auditLog?.('domain.disconnected', actor, { domainId, hostname: removed.hostname });
      return sendJson(res, 200, { domain: removed });
    }

    return false;
  };
}

export {
  resolvePublicHost,
  renderPublishedSiteHtml,
  generateTenantSitemapXml,
  generateTenantRobotsTxt,
  createPublicPageCache,
  versionsRepo
};
