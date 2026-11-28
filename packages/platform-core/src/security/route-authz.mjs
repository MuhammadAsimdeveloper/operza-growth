/**
 * ============================================================================
 * Operza Platform-Wide Route Authorization Helper (Stage 18 Hardening)
 * ============================================================================
 * Consolidates API-key scope checking and cookie-session RBAC role enforcement
 * onto the canonical Stage 17 permission model (BUILTIN_ROLE_TEMPLATES + custom roles).
 * Fails closed when actor is missing or lacks the required permission.
 */

import { BUILTIN_ROLE_TEMPLATES, getPermissionsForRole, hasPermission } from '../agency-governance-2-0.mjs';

const LEGACY_SCOPE_EQUIVALENTS = Object.freeze({
  'crm:read': ['contacts:read'],
  'crm:write': ['contacts:create', 'contacts:write'],
  'payments:read': ['orders:read', 'billing:read'],
  'payments:write': ['invoices:write', 'refunds:approve', 'payments:configure'],
  'invoices:read': ['billing:read', 'orders:read'],
  'support:read': ['conversations:read'],
  'support:write': ['conversations:write', 'tickets:manage'],
  'forms:read': ['campaigns:read', 'contacts:read'],
  'forms:write': ['campaigns:write', 'contacts:write'],
  'funnels:read': ['campaigns:read', 'agency:settings:read'],
  'funnels:write': ['campaigns:write'],
  'websites:read': ['campaigns:read', 'agency:settings:read'],
  'websites:write': ['campaigns:write'],
  'pipelines:read': ['opportunities:manage', 'contacts:read'],
  'pipelines:write': ['opportunities:manage'],
  'opportunities:read': ['opportunities:manage', 'contacts:read'],
  'opportunities:write': ['opportunities:manage'],
  'reviews:read': ['contacts:read'],
  'reviews:write': ['contacts:write'],
  'tasks:read': ['contacts:read'],
  'tasks:write': ['contacts:write'],
  'scheduling:read': ['contacts:read'],
  'scheduling:write': ['contacts:write'],
  'consents:read': ['consents:manage', 'contacts:read'],
  'consents:write': ['consents:manage'],
  'integrations:read': ['agency:settings:read'],
  'integrations:write': ['agency:settings:write'],
  'portal:read': ['agency:settings:read', 'contacts:read'],
  'portal:write': ['agency:settings:write', 'tickets:manage']
});

export function resolveActorPermissions(actor) {
  if (!actor) return [];
  if (actor.apiKey) {
    return Array.isArray(actor.scopes) ? actor.scopes : [];
  }
  if (Array.isArray(actor.permissions) && actor.permissions.length > 0) {
    return actor.permissions;
  }
  const roleSlug = String(actor.membership?.role || actor.user?.role || '').toLowerCase();
  if (!roleSlug) return [];
  if (BUILTIN_ROLE_TEMPLATES[roleSlug]) {
    return BUILTIN_ROLE_TEMPLATES[roleSlug].permissions;
  }
  return getPermissionsForRole(roleSlug, actor.customRoles || []);
}

export function checkActorPermission(actor, requiredPerm, alternativePerms = []) {
  if (!actor) return false;
  const granted = resolveActorPermissions(actor);
  if (granted.includes('*') || granted.includes('all')) return true;

  const candidates = [requiredPerm, ...(Array.isArray(alternativePerms) ? alternativePerms : [])].filter(Boolean);
  for (const perm of candidates) {
    if (hasPermission(granted, perm)) return true;
    const equivalents = LEGACY_SCOPE_EQUIVALENTS[perm];
    if (equivalents && equivalents.some(eq => hasPermission(granted, eq))) {
      return true;
    }
  }
  return false;
}

export function canActorViewFinancials(actor) {
  return checkActorPermission(actor, 'billing:read', ['orders:read', 'payments:read', 'reports:financial:read', 'agency:billing:manage']);
}

export function isPlatformAdminActor(actor) {
  return Boolean(actor?.isPlatformAdmin === true || actor?.user?.isPlatformAdmin === true);
}
