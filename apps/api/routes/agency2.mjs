/**
 * ============================================================================
 * Operza Agency Workspace, Team Management & Access Governance 2.0 Router
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createAgencyGovernanceRepository } from '../../../packages/db/lib/agency-governance-repository.mjs';
import {
  BUILTIN_ROLE_TEMPLATES,
  PERMISSION_CATALOG,
  computeOnboardingProgress,
  getPermissionsForRole
} from '../../../packages/platform-core/src/agency-governance-2-0.mjs';

const govRepo = createAgencyGovernanceRepository();

function getCallerRole(actor) {
  return String(actor?.membership?.role || actor?.user?.role || 'member').toLowerCase();
}

function getCallerPermissions(actor) {
  if (actor?.apiKey) return actor.scopes || [];
  return getPermissionsForRole(getCallerRole(actor));
}

function requireAdminOrPerm(actor, perm) {
  const role = getCallerRole(actor);
  if (role === 'owner' || role === 'admin') return true;
  const perms = getCallerPermissions(actor);
  return perms.includes('*') || perms.includes('all') || perms.includes(perm);
}

export async function handleAgency2Routes(req, res, ctx) {
  const {
    method,
    pathname,
    url,
    readBody,
    sendJson,
    state,
    saveState,
    auditLog,
    actor,
    agency,
    activeLocation,
    pgPool
  } = ctx;

  if (!pathname.startsWith('/api/agency/v2')) return false;

  if (!agency || !activeLocation) {
    sendJson(res, 401, { error: 'Authenticated agency context required', code: 'TENANT_CONTEXT_REQUIRED' });
    return true;
  }

  const subPath = pathname.replace(/^\/api\/agency\/v2/, '');
  const queryUrl = url || new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);
  const actorId = actor?.user?.id || actor?.keyId || 'system';
  const callerRole = getCallerRole(actor);
  const callerPermissions = getCallerPermissions(actor);
  const tenantCtx = { agencyId: agency.id, locationId: activeLocation.id, actorId };

  // 1. Agency Workspace Profile
  if (subPath === '/workspace') {
    if (method === 'GET') {
      if (pgPool) {
        const ws = await runInTenantTx(pgPool, tenantCtx, tx => govRepo.getAgencyWorkspace(tx));
        sendJson(res, 200, { workspace: ws });
        return true;
      }
      sendJson(res, 200, {
        workspace: {
          id: agency.id,
          name: agency.name,
          slug: agency.slug || 'main-workspace',
          status: agency.status || 'active',
          email: agency.email || '',
          phone: agency.phone || '',
          website: agency.website || '',
          category: agency.category || '',
          country: agency.country || 'US',
          defaultLanguage: agency.defaultLanguage || 'en',
          defaultTimezone: agency.timezone || agency.defaultTimezone || 'UTC',
          defaultCurrency: agency.currency || agency.defaultCurrency || 'USD',
          createdAt: agency.createdAt || new Date().toISOString()
        }
      });
      return true;
    }

    if (method === 'PUT') {
      if (!requireAdminOrPerm(actor, 'agency:settings:write')) {
        sendJson(res, 403, { error: 'Insufficient permissions to update agency workspace settings', code: 'FORBIDDEN' });
        return true;
      }
      const body = await readBody(req);
      if (pgPool) {
        try {
          const ws = await runInTenantTx(pgPool, tenantCtx, tx => govRepo.updateAgencyWorkspace(tx, body || {}));
          auditLog?.('agency.workspace.updated', actor, { agencyId: agency.id });
          sendJson(res, 200, { workspace: ws });
        } catch (err) {
          sendJson(res, err.status || 400, { error: err.message, code: err.code || 'WORKSPACE_UPDATE_FAILED' });
        }
        return true;
      }
      Object.assign(agency, {
        name: body?.name?.trim() || agency.name,
        email: body?.email?.trim() ?? agency.email,
        phone: body?.phone?.trim() ?? agency.phone,
        website: body?.website?.trim() ?? agency.website,
        category: body?.category?.trim() ?? agency.category,
        country: body?.country?.trim() ?? agency.country,
        defaultLanguage: body?.defaultLanguage?.trim() ?? agency.defaultLanguage,
        timezone: body?.defaultTimezone?.trim() ?? agency.timezone,
        currency: body?.defaultCurrency?.trim() ?? agency.currency
      });
      await saveState?.();
      auditLog?.('agency.workspace.updated', actor, { agencyId: agency.id });
      sendJson(res, 200, { workspace: agency });
      return true;
    }
  }

  // 2. Multi-Location Management
  if (subPath === '/locations') {
    if (method === 'GET') {
      const locations = pgPool
        ? await runInTenantTx(pgPool, tenantCtx, tx => govRepo.listLocations(tx))
        : (state.locations || []).filter(l => l.agencyId === agency.id);
      sendJson(res, 200, { locations });
      return true;
    }
    if (method === 'POST') {
      if (!requireAdminOrPerm(actor, 'agency:locations:manage')) {
        sendJson(res, 403, { error: 'Insufficient permissions to create locations', code: 'FORBIDDEN' });
        return true;
      }
      const body = await readBody(req);
      if (pgPool) {
        try {
          const loc = await runInTenantTx(pgPool, tenantCtx, tx => govRepo.createLocation(tx, body || {}));
          auditLog?.('agency.location.created', actor, { locationId: loc.id, name: loc.name });
          sendJson(res, 201, { location: loc });
        } catch (err) {
          sendJson(res, err.status || 400, { error: err.message, code: err.code || 'LOCATION_CREATE_FAILED' });
        }
        return true;
      }
      const loc = { id: randomUUID(), agencyId: agency.id, name: body?.name || 'New Location', timezone: body?.timezone || 'UTC', status: 'active', createdAt: new Date().toISOString() };
      state.locations = state.locations || [];
      state.locations.push(loc);
      await saveState?.();
      auditLog?.('agency.location.created', actor, { locationId: loc.id, name: loc.name });
      sendJson(res, 201, { location: loc });
      return true;
    }
  }

  const locStatusMatch = subPath.match(/^\/locations\/([^/]+)\/(archive|restore)$/);
  if (method === 'POST' && locStatusMatch) {
    if (!requireAdminOrPerm(actor, 'agency:locations:manage')) {
      sendJson(res, 403, { error: 'Insufficient permissions', code: 'FORBIDDEN' });
      return true;
    }
    const [, locId, action] = locStatusMatch;
    const targetStatus = action === 'archive' ? 'inactive' : 'active';
    if (pgPool) {
      const loc = await runInTenantTx(pgPool, tenantCtx, tx => govRepo.setLocationStatus(tx, locId, targetStatus));
      if (!loc) { sendJson(res, 404, { error: 'Location not found' }); return true; }
      auditLog?.(`agency.location.${action}d`, actor, { locationId: locId });
      sendJson(res, 200, { location: loc });
      return true;
    }
    const loc = (state.locations || []).find(l => l.id === locId && l.agencyId === agency.id);
    if (!loc) { sendJson(res, 404, { error: 'Location not found' }); return true; }
    loc.status = targetStatus;
    await saveState?.();
    sendJson(res, 200, { location: loc });
    return true;
  }

  // 3. Team Members & Offboarding
  if (method === 'GET' && subPath === '/team') {
    const search = queryUrl.searchParams.get('search') || '';
    const status = queryUrl.searchParams.get('status') || 'all';
    if (pgPool) {
      const members = await runInTenantTx(pgPool, tenantCtx, tx => govRepo.listTeamMembers(tx, { search, status }));
      sendJson(res, 200, { members });
      return true;
    }
    const mems = (state.records?.team || []).filter(m => m.agencyId === agency.id);
    sendJson(res, 200, { members: mems });
    return true;
  }

  const offboardMatch = subPath.match(/^\/team\/([^/]+)\/offboard$/);
  if (method === 'POST' && offboardMatch) {
    if (!requireAdminOrPerm(actor, 'agency:users:manage')) {
      sendJson(res, 403, { error: 'Insufficient permissions to offboard team members', code: 'FORBIDDEN' });
      return true;
    }
    const userId = offboardMatch[1];
    if (pgPool) {
      try {
        const result = await runInTenantTx(pgPool, tenantCtx, tx => govRepo.offboardMember(tx, { userId, actorId }));
        if (result.notFound) { sendJson(res, 404, { error: 'Team member not found' }); return true; }
        auditLog?.('agency.member.offboarded', actor, { targetUserId: userId, revokedSessions: result.revokedSessionsCount });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, err.status || 400, { error: err.message, code: err.code || 'OFFBOARD_FAILED' });
      }
      return true;
    }
    const mem = (state.records?.team || []).find(m => m.id === userId && m.agencyId === agency.id);
    if (!mem) { sendJson(res, 404, { error: 'Team member not found' }); return true; }
    mem.status = 'inactive';
    await saveState?.();
    auditLog?.('agency.member.offboarded', actor, { targetUserId: userId });
    sendJson(res, 200, { success: true, userId });
    return true;
  }

  // 4. Invitations Lifecycle
  if (subPath === '/invitations') {
    if (method === 'GET') {
      if (!requireAdminOrPerm(actor, 'agency:users:manage')) {
        sendJson(res, 403, { error: 'Insufficient permissions', code: 'FORBIDDEN' });
        return true;
      }
      const invitations = pgPool
        ? await runInTenantTx(pgPool, tenantCtx, tx => govRepo.listInvitations(tx))
        : (state.agencyInvitations || []).filter(i => i.agencyId === agency.id);
      sendJson(res, 200, { invitations });
      return true;
    }
    if (method === 'POST') {
      if (!requireAdminOrPerm(actor, 'agency:users:manage')) {
        sendJson(res, 403, { error: 'Insufficient permissions to invite users', code: 'FORBIDDEN' });
        return true;
      }
      const body = await readBody(req);
      if (pgPool) {
        try {
          const result = await runInTenantTx(pgPool, tenantCtx, tx =>
            govRepo.createInvitation(tx, { ...(body || {}), invitedBy: actorId })
          );
          auditLog?.('agency.invitation.created', actor, { inviteId: result.invitation.id, role: result.invitation.role });
          sendJson(res, 201, {
            invitation: result.invitation,
            deliveryNotice: 'Local/test adapter mode: no external email sent.',
            testToken: process.env.NODE_ENV !== 'production' ? result.rawToken : undefined
          });
        } catch (err) {
          sendJson(res, err.status || 400, { error: err.message, code: err.code || 'INVITE_FAILED' });
        }
        return true;
      }
      const inv = {
        id: randomUUID(),
        agencyId: agency.id,
        email: String(body?.email || '').toLowerCase().trim(),
        role: body?.role || 'member',
        status: 'pending',
        deliveryStatus: 'pending_local',
        createdAt: new Date().toISOString()
      };
      state.agencyInvitations = state.agencyInvitations || [];
      state.agencyInvitations.push(inv);
      await saveState?.();
      sendJson(res, 201, { invitation: inv, deliveryNotice: 'Local/test adapter mode: no external email sent.' });
      return true;
    }
  }

  const revokeInvMatch = subPath.match(/^\/invitations\/([^/]+)\/revoke$/);
  if (method === 'POST' && revokeInvMatch) {
    if (!requireAdminOrPerm(actor, 'agency:users:manage')) {
      sendJson(res, 403, { error: 'Insufficient permissions', code: 'FORBIDDEN' });
      return true;
    }
    const inviteId = revokeInvMatch[1];
    if (pgPool) {
      const revoked = await runInTenantTx(pgPool, tenantCtx, tx => govRepo.revokeInvitation(tx, { inviteId, actorId }));
      if (!revoked) { sendJson(res, 404, { error: 'Pending invitation not found' }); return true; }
      auditLog?.('agency.invitation.revoked', actor, { inviteId });
      sendJson(res, 200, { invitation: revoked });
      return true;
    }
    const inv = (state.agencyInvitations || []).find(i => i.id === inviteId && i.agencyId === agency.id);
    if (!inv) { sendJson(res, 404, { error: 'Invitation not found' }); return true; }
    inv.status = 'revoked';
    await saveState?.();
    sendJson(res, 200, { invitation: inv });
    return true;
  }

  // 5. Roles & Permissions
  if (subPath === '/roles') {
    if (method === 'GET') {
      if (pgPool) {
        const roles = await runInTenantTx(pgPool, tenantCtx, tx => govRepo.listRoles(tx));
        sendJson(res, 200, { ...roles, permissionCatalog: PERMISSION_CATALOG });
        return true;
      }
      sendJson(res, 200, {
        builtinRoles: Object.values(BUILTIN_ROLE_TEMPLATES),
        customRoles: (state.agencyRoles || []).filter(r => r.agencyId === agency.id),
        permissionCatalog: PERMISSION_CATALOG
      });
      return true;
    }
    if (method === 'POST') {
      if (!requireAdminOrPerm(actor, 'agency:roles:manage')) {
        sendJson(res, 403, { error: 'Insufficient permissions to manage roles', code: 'FORBIDDEN' });
        return true;
      }
      const body = await readBody(req);
      if (pgPool) {
        try {
          const role = await runInTenantTx(pgPool, tenantCtx, tx =>
            govRepo.createCustomRole(tx, {
              ...(body || {}),
              actorRole: callerRole,
              actorPermissions: callerPermissions,
              actorId
            })
          );
          auditLog?.('agency.role.created', actor, { roleId: role.id, slug: role.slug });
          sendJson(res, 201, { role });
        } catch (err) {
          sendJson(res, err.status || 400, { error: err.message, code: err.code || 'ROLE_CREATE_FAILED' });
        }
        return true;
      }
      const role = { id: randomUUID(), agencyId: agency.id, ...(body || {}), isSystem: false };
      state.agencyRoles = state.agencyRoles || [];
      state.agencyRoles.push(role);
      await saveState?.();
      sendJson(res, 201, { role });
      return true;
    }
  }

  // 6. Active Sessions & Revocation
  if (method === 'GET' && subPath === '/sessions') {
    if (!requireAdminOrPerm(actor, 'agency:users:manage')) {
      sendJson(res, 403, { error: 'Insufficient permissions', code: 'FORBIDDEN' });
      return true;
    }
    if (pgPool) {
      const sessions = await runInTenantTx(pgPool, tenantCtx, tx => govRepo.listActiveSessions(tx));
      sendJson(res, 200, { sessions, mfaNotice: 'Native TOTP/WebAuthn MFA is not enabled in this local auth configuration.' });
      return true;
    }
    const sessions = (state.sessions || [])
      .filter(s => s.agencyId === agency.id && !s.revokedAt)
      .map(s => ({ id: s.id, userId: s.userId, userAgent: 'Browser session', expiresAt: s.expiresAt, createdAt: s.createdAt }));
    sendJson(res, 200, { sessions, mfaNotice: 'Native TOTP/WebAuthn MFA is not enabled in this local auth configuration.' });
    return true;
  }

  const revokeSessMatch = subPath.match(/^\/sessions\/([^/]+)\/revoke$/);
  if (method === 'POST' && revokeSessMatch) {
    if (!requireAdminOrPerm(actor, 'agency:users:manage')) {
      sendJson(res, 403, { error: 'Insufficient permissions', code: 'FORBIDDEN' });
      return true;
    }
    const sessionId = revokeSessMatch[1];
    if (pgPool) {
      const revoked = await runInTenantTx(pgPool, tenantCtx, tx => govRepo.revokeSession(tx, { sessionId, actorId }));
      if (!revoked) { sendJson(res, 404, { error: 'Active session not found' }); return true; }
      auditLog?.('agency.session.revoked', actor, { sessionId });
      sendJson(res, 200, { session: revoked });
      return true;
    }
    const sess = (state.sessions || []).find(s => s.id === sessionId && s.agencyId === agency.id);
    if (!sess) { sendJson(res, 404, { error: 'Session not found' }); return true; }
    sess.revokedAt = new Date().toISOString();
    await saveState?.();
    sendJson(res, 200, { session: { id: sess.id, revokedAt: sess.revokedAt } });
    return true;
  }

  // 7. Agency Onboarding Progress
  if (subPath === '/onboarding') {
    if (method === 'GET') {
      if (pgPool) {
        const onboarding = await runInTenantTx(pgPool, tenantCtx, tx => govRepo.getOnboardingSummary(tx));
        sendJson(res, 200, { onboarding });
        return true;
      }
      const onboarding = computeOnboardingProgress({
        agency,
        locations: (state.locations || []).filter(l => l.agencyId === agency.id),
        members: (state.records?.team || []).filter(m => m.agencyId === agency.id),
        onboardingState: agency.onboardingState || {}
      });
      sendJson(res, 200, { onboarding });
      return true;
    }
    if (method === 'PATCH') {
      const body = await readBody(req);
      if (pgPool) {
        const onboarding = await runInTenantTx(pgPool, tenantCtx, tx => govRepo.updateOnboardingState(tx, body || {}));
        sendJson(res, 200, { onboarding });
        return true;
      }
      agency.onboardingState = { ...(agency.onboardingState || {}), ...(body || {}) };
      await saveState?.();
      sendJson(res, 200, {
        onboarding: computeOnboardingProgress({
          agency,
          locations: (state.locations || []).filter(l => l.agencyId === agency.id),
          members: (state.records?.team || []).filter(m => m.agencyId === agency.id),
          onboardingState: agency.onboardingState
        })
      });
      return true;
    }
  }

  return false;
}
