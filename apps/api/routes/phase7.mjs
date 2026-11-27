/**
 * Phase 7 — SaaS Subscriptions, Marketplace, OAuth 2.0, Reporting & Platform Admin Routes
 */

import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createSaasSubscriptionsRepository } from '../../../packages/db/lib/saas-subscriptions-repository.mjs';
import { createMarketplaceRepository } from '../../../packages/db/lib/marketplace-repository.mjs';
import { createOAuthRepository } from '../../../packages/db/lib/oauth-repository.mjs';
import { createReportingRepository } from '../../../packages/db/lib/reporting-repository.mjs';
import { resolveEntitlements } from '../../../packages/platform-core/src/entitlements.mjs';
import { createAuthRateLimiter } from '../../../packages/platform-core/src/security/auth-rate-limiter.mjs';
import { handleMarketplace2Routes } from './marketplace2.mjs';

const oauthRateLimiter = createAuthRateLimiter({
  trustProxy: process.env.TRUST_PROXY === 'true',
  strictDistributed: process.env.DISTRIBUTED_RATE_LIMIT_STRICT === 'true'
});

const subsRepo = createSaasSubscriptionsRepository();
const marketRepo = createMarketplaceRepository();
const oauthRepo = createOAuthRepository();
const reportRepo = createReportingRepository();

export function createPhase7Routes({ pgPool = null, sendJson, readBody, auditLog } = {}) {
  return async function handlePhase7Route({ method, pathname, req, res, agency, activeLocation, actor }) {
    if (await handleMarketplace2Routes(req, res, { method, pathname, actor, agency, activeLocation, pgPool, readBody, sendJson })) {
      return true;
    }
    const isPhase7Path =
      pathname.startsWith('/api/saas/') ||
      pathname.startsWith('/api/marketplace/') ||
      pathname.startsWith('/api/oauth/') ||
      pathname.startsWith('/api/reports/') ||
      pathname.startsWith('/api/platform-admin/');

    if (!isPhase7Path) return false;
    if (!pgPool) {
      return sendJson(res, 503, { error: 'PostgreSQL is required for Phase 7 SaaS/OAuth/Admin routes', code: 'PG_REQUIRED' });
    }

    // Strict privilege separation for Platform Admin control plane
    if (pathname.startsWith('/api/platform-admin/')) {
      if (actor?.isPlatformAdmin !== true) {
        return sendJson(res, 403, { error: 'Platform administrator privilege required', code: 'PLATFORM_ADMIN_REQUIRED' });
      }
      if (method === 'POST' && pathname.startsWith('/api/platform-admin/marketplace/') && pathname.endsWith('/review')) {
        const appId = pathname.replace('/api/platform-admin/marketplace/', '').replace('/review', '').trim();
        const body = await readBody(req);
        const updated = await marketRepo.reviewApp(pgPool, appId, {
          status: body?.status,
          reviewedBy: actor?.user?.id || actor?.id || 'platform_admin'
        });
        await pgPool.query(
          `INSERT INTO platform_admin_audit_log (actor_id, action, target_type, target_id, reason)
           VALUES ($1, 'marketplace.review', 'marketplace_app', $2, $3)`,
          [actor?.user?.id || actor?.id || 'platform_admin', appId, body?.reason || null]
        );
        return sendJson(res, 200, { app: updated });
      }
      if (method === 'GET' && pathname === '/api/platform-admin/audit') {
        const logs = await pgPool.query(`SELECT * FROM platform_admin_audit_log ORDER BY created_at DESC LIMIT 100`);
        return sendJson(res, 200, { logs: logs.rows });
      }
      return sendJson(res, 404, { error: 'Unknown platform-admin route' });
    }

    const tenantCtx = {
      agencyId: agency?.id,
      locationId: activeLocation?.id,
      actorId: actor?.user?.id || actor?.id || 'system'
    };

    if (method === 'GET' && pathname === '/api/saas/subscription') {
      const sub = await runInTenantTx(pgPool, tenantCtx, (tx) => subsRepo.getSubscription(tx));
      const entitlements = resolveEntitlements({ planId: sub?.plan_id || 'beta' });
      return sendJson(res, 200, { subscription: sub, entitlements });
    }

    if (method === 'POST' && pathname === '/api/saas/subscription') {
      const role = actor?.membership?.role || actor?.role;
      if (!['owner', 'admin'].includes(role)) {
        return sendJson(res, 403, { error: 'Owner or admin role required', code: 'FORBIDDEN' });
      }
      const body = await readBody(req);
      const sub = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        subsRepo.upsertSubscription(tx, {
          planId: body?.planId,
          status: body?.status || 'active',
          stripeSubscriptionId: body?.stripeSubscriptionId || null
        })
      );
      auditLog?.('saas.subscription_updated', actor, { planId: sub.plan_id, status: sub.status });
      return sendJson(res, 200, { subscription: sub, entitlements: resolveEntitlements({ planId: sub.plan_id }) });
    }

    if (method === 'GET' && pathname === '/api/marketplace/apps') {
      const apps = await marketRepo.listPublishedApps(pgPool);
      return sendJson(res, 200, { apps });
    }

    if (method === 'GET' && pathname === '/api/marketplace/installations') {
      const installations = await runInTenantTx(pgPool, tenantCtx, (tx) => marketRepo.listInstallations(tx));
      return sendJson(res, 200, { installations });
    }

    if (method === 'POST' && pathname === '/api/marketplace/install') {
      const body = await readBody(req);
      try {
        const inst = await runInTenantTx(pgPool, tenantCtx, (tx) =>
          marketRepo.installApp(tx, {
            appId: body?.appId,
            installedBy: tenantCtx.actorId,
            grantedScopes: Array.isArray(body?.grantedScopes) ? body.grantedScopes : []
          })
        );
        return sendJson(res, 201, { installation: inst });
      } catch (err) {
        return sendJson(res, 400, { error: err.message, code: err.code || 'INSTALL_FAILED' });
      }
    }

    if (method === 'POST' && pathname === '/api/marketplace/uninstall') {
      const body = await readBody(req);
      const removed = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        marketRepo.uninstallApp(tx, body?.installationId)
      );
      return sendJson(res, 200, { installation: removed });
    }

    if (method === 'POST' && pathname === '/api/oauth/apps') {
      const body = await readBody(req);
      const created = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        oauthRepo.createApp(tx, {
          name: body?.name,
          redirectUris: body?.redirectUris,
          allowedScopes: body?.allowedScopes,
          createdBy: tenantCtx.actorId
        })
      );
      return sendJson(res, 201, created);
    }

    if (method === 'POST' && pathname === '/api/oauth/authorize') {
      const body = await readBody(req);
      const rl = await oauthRateLimiter.check({ action: 'oauth_authorize', req, identifier: body?.clientId || tenantCtx.actorId });
      if (!rl.allowed) {
        return sendJson(res, 429, { error: 'Too many OAuth authorization requests', code: rl.code }, { 'retry-after': String(rl.retryAfterSec) });
      }
      const issued = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        oauthRepo.issueAuthorizationCode(tx, {
          clientId: body?.clientId,
          userId: tenantCtx.actorId,
          redirectUri: body?.redirectUri,
          scopes: body?.scopes || [],
          codeChallenge: body?.codeChallenge || null
        })
      );
      return sendJson(res, 200, issued);
    }

    if (method === 'POST' && pathname === '/api/oauth/token') {
      const body = await readBody(req);
      const rl = await oauthRateLimiter.check({ action: 'oauth_token', req, identifier: body?.clientId || tenantCtx.actorId });
      if (!rl.allowed) {
        return sendJson(res, 429, { error: 'Too many OAuth token requests', code: rl.code }, { 'retry-after': String(rl.retryAfterSec) });
      }
      try {
        if (body?.grantType === 'refresh_token') {
          const rotated = await runInTenantTx(pgPool, tenantCtx, (tx) =>
            oauthRepo.rotateRefreshToken(tx, {
              clientId: body?.clientId,
              clientSecret: body?.clientSecret,
              refreshToken: body?.refreshToken
            })
          );
          return sendJson(res, 200, rotated);
        }
        const tokens = await runInTenantTx(pgPool, tenantCtx, (tx) =>
          oauthRepo.exchangeAuthorizationCode(tx, {
            clientId: body?.clientId,
            clientSecret: body?.clientSecret,
            code: body?.code,
            redirectUri: body?.redirectUri,
            codeVerifier: body?.codeVerifier || null
          })
        );
        return sendJson(res, 200, tokens);
      } catch (err) {
        return sendJson(res, 400, { error: err.message, code: err.code || 'OAUTH_TOKEN_ERROR' });
      }
    }

    if (method === 'GET' && pathname === '/api/reports/summary') {
      const summary = await runInTenantTx(pgPool, tenantCtx, (tx) => reportRepo.getWorkspaceSummary(tx));
      return sendJson(res, 200, { summary });
    }

    return false;
  };
}
