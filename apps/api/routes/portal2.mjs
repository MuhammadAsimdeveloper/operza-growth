import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createCustomerPortal2Repository } from '../../../packages/db/lib/customer-portal-2-repository.mjs';
import { sanitizeCustomerProfilePatch, filterCustomerVisibleMessages } from '../../../packages/platform-core/src/customer-portal-2-0.mjs';
import { checkActorPermission } from '../../../packages/platform-core/src/security/route-authz.mjs';

const repo = createCustomerPortal2Repository();

export async function handlePortal2Routes({ req, res, pathname, method, ctx }) {
  if (!pathname.startsWith('/api/portal/v2')) return false;

  const { pgPool, agency, activeLocation, actor, readBody, sendJson } = ctx;
  if (!agency || !activeLocation) {
    sendJson(res, 401, { error: 'Authentication required' });
    return true;
  }

  // Stateless helper endpoints for profile field sanitization & internal note filtering
  if (method === 'POST' && pathname === '/api/portal/v2/profile/validate') {
    try {
      const body = await readBody(req);
      const sanitized = sanitizeCustomerProfilePatch(body.patch || {}, body.allowedFields || null);
      sendJson(res, 200, { valid: true, sanitized });
    } catch (err) {
      sendJson(res, 400, { error: err.message, code: err.code || 'RESTRICTED_PROFILE_FIELD' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/portal/v2/messages/filter') {
    const body = await readBody(req);
    sendJson(res, 200, { messages: filterCustomerVisibleMessages(body.messages || []) });
    return true;
  }

  if (!pgPool) {
    sendJson(res, 503, { error: 'PostgreSQL is required for Customer Portal 2.0 persistence', code: 'DATABASE_UNAVAILABLE' });
    return true;
  }

  const tenantCtx = {
    agencyId: agency.id,
    locationId: activeLocation.id,
    actorId: actor?.id || actor?.userId || 'system'
  };

  try {
    if (method === 'GET' && pathname === '/api/portal/v2/config') {
      if (!checkActorPermission(actor, 'agency:settings:read', ['portal:read'])) {
        sendJson(res, 403, { error: 'Insufficient permissions: agency:settings:read required', code: 'FORBIDDEN' });
        return true;
      }
      const config = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.getConfig(tx));
      sendJson(res, 200, { config });
      return true;
    }
    if (method === 'PUT' && pathname === '/api/portal/v2/config') {
      if (!checkActorPermission(actor, 'agency:settings:write', ['portal:write'])) {
        sendJson(res, 403, { error: 'Insufficient permissions: agency:settings:write required', code: 'FORBIDDEN' });
        return true;
      }
      const body = await readBody(req);
      const config = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        repo.upsertConfig(tx, { ...body, updatedBy: tenantCtx.actorId })
      );
      sendJson(res, 200, { config });
      return true;
    }
    if (method === 'GET' && pathname === '/api/portal/v2/requests') {
      if (!checkActorPermission(actor, 'conversations:read', ['tickets:manage', 'portal:read'])) {
        sendJson(res, 403, { error: 'Insufficient permissions: conversations:read required', code: 'FORBIDDEN' });
        return true;
      }
      const data = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.listRequests(tx));
      sendJson(res, 200, { data });
      return true;
    }
    if (method === 'POST' && pathname === '/api/portal/v2/requests') {
      if (!checkActorPermission(actor, 'tickets:manage', ['conversations:write', 'portal:write'])) {
        sendJson(res, 403, { error: 'Insufficient permissions: tickets:manage required', code: 'FORBIDDEN' });
        return true;
      }
      const body = await readBody(req);
      const created = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.createRequest(tx, body));
      sendJson(res, 201, created);
      return true;
    }
    if (method === 'POST' && pathname.startsWith('/api/portal/v2/requests/') && pathname.endsWith('/transition')) {
      if (!checkActorPermission(actor, 'tickets:manage', ['conversations:write', 'portal:write'])) {
        sendJson(res, 403, { error: 'Insufficient permissions: tickets:manage required', code: 'FORBIDDEN' });
        return true;
      }
      const requestId = pathname.split('/')[5];
      const body = await readBody(req);
      const updated = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        repo.transitionRequest(tx, {
          requestId,
          toStatus: body.status,
          resolutionNote: body.resolutionNote,
          actorId: tenantCtx.actorId
        })
      );
      if (!updated) {
        sendJson(res, 404, { error: 'Request not found' });
        return true;
      }
      sendJson(res, 200, updated);
      return true;
    }
    sendJson(res, 404, { error: 'Portal 2.0 endpoint not found' });
    return true;
  } catch (err) {
    const code = err?.code || 'PORTAL_ERROR';
    const status = ['MAGIC_LINK_INVALID', 'MAGIC_LINK_EXPIRED', 'MAGIC_LINK_ALREADY_USED', 'INVALID_REQUEST_TRANSITION', 'RESTRICTED_PROFILE_FIELD'].includes(code)
      ? 400
      : 500;
    sendJson(res, status, { error: err.message, code });
    return true;
  }
}
