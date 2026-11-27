/**
 * ============================================================================
 * Operza Agency Workspace, Team Management & Access Governance 2.0
 * ============================================================================
 */

import { createHash, randomBytes } from 'node:crypto';

export const PERMISSION_CATALOG = Object.freeze({
  agency: [
    'agency:settings:read',
    'agency:settings:write',
    'agency:billing:manage',
    'agency:locations:manage',
    'agency:users:manage',
    'agency:roles:manage',
    'agency:audit:read'
  ],
  crm: [
    'contacts:read',
    'contacts:create',
    'contacts:write',
    'contacts:archive',
    'opportunities:manage',
    'contacts:sensitive:read'
  ],
  support: [
    'conversations:read',
    'conversations:write',
    'conversations:notes:read',
    'conversations:assign',
    'tickets:manage',
    'sla:configure'
  ],
  marketing: [
    'campaigns:read',
    'campaigns:write',
    'campaigns:approve',
    'campaigns:execute',
    'consents:manage'
  ],
  workflows: [
    'workflows:read',
    'workflows:create',
    'workflows:write',
    'workflows:trigger',
    'workflows:operations'
  ],
  commerce: [
    'orders:read',
    'billing:read',
    'invoices:write',
    'refunds:approve',
    'payments:configure'
  ],
  ai: [
    'ai:read',
    'ai:models:configure',
    'ai:agents:manage',
    'ai:memory:read',
    'ai:governance:manage'
  ],
  analytics: [
    'reports:read',
    'reports:create',
    'reports:export',
    'reports:financial:read'
  ]
});

export const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSION_CATALOG).flat());

const AGENCY_ADMIN_ONLY_PERMISSIONS = new Set([
  'agency:settings:write',
  'agency:billing:manage',
  'agency:roles:manage',
  'agency:users:manage',
  'payments:configure'
]);

export const BUILTIN_ROLE_TEMPLATES = Object.freeze({
  owner: {
    slug: 'owner',
    name: 'Agency Owner',
    scope: 'agency',
    permissions: ['*']
  },
  admin: {
    slug: 'admin',
    name: 'Agency Administrator',
    scope: 'agency',
    permissions: ALL_PERMISSIONS
  },
  operations_manager: {
    slug: 'operations_manager',
    name: 'Operations Manager',
    scope: 'agency',
    permissions: [
      'agency:settings:read', 'agency:locations:manage', 'agency:audit:read',
      ...PERMISSION_CATALOG.crm, ...PERMISSION_CATALOG.support, ...PERMISSION_CATALOG.workflows, ...PERMISSION_CATALOG.analytics
    ]
  },
  location_manager: {
    slug: 'location_manager',
    name: 'Location Manager',
    scope: 'location',
    permissions: [
      'agency:settings:read', ...PERMISSION_CATALOG.crm, ...PERMISSION_CATALOG.support,
      'campaigns:read', 'campaigns:write', 'workflows:read', 'workflows:trigger', 'reports:read'
    ]
  },
  sales_manager: {
    slug: 'sales_manager',
    name: 'Sales Manager',
    scope: 'location',
    permissions: [...PERMISSION_CATALOG.crm, 'conversations:read', 'conversations:write', 'reports:read']
  },
  sales_agent: {
    slug: 'sales_agent',
    name: 'Sales Agent',
    scope: 'location',
    permissions: ['contacts:read', 'contacts:create', 'contacts:write', 'opportunities:manage', 'conversations:read', 'conversations:write']
  },
  support_manager: {
    slug: 'support_manager',
    name: 'Support Manager',
    scope: 'location',
    permissions: ['contacts:read', ...PERMISSION_CATALOG.support, 'reports:read']
  },
  support_agent: {
    slug: 'support_agent',
    name: 'Support Agent',
    scope: 'location',
    permissions: ['contacts:read', 'conversations:read', 'conversations:write', 'conversations:notes:read', 'tickets:manage']
  },
  marketing_manager: {
    slug: 'marketing_manager',
    name: 'Marketing Manager',
    scope: 'location',
    permissions: ['contacts:read', ...PERMISSION_CATALOG.marketing, 'workflows:read', 'workflows:write', 'reports:read']
  },
  marketing_specialist: {
    slug: 'marketing_specialist',
    name: 'Marketing Specialist',
    scope: 'location',
    permissions: ['contacts:read', 'campaigns:read', 'campaigns:write', 'reports:read']
  },
  analyst: {
    slug: 'analyst',
    name: 'Analyst',
    scope: 'location',
    permissions: ['contacts:read', 'conversations:read', 'campaigns:read', 'workflows:read', 'orders:read', ...PERMISSION_CATALOG.analytics]
  },
  read_only: {
    slug: 'read_only',
    name: 'Read Only',
    scope: 'location',
    permissions: ['agency:settings:read', 'contacts:read', 'conversations:read', 'campaigns:read', 'workflows:read', 'reports:read']
  }
});

export function getPermissionsForRole(roleSlug, customRoles = []) {
  if (BUILTIN_ROLE_TEMPLATES[roleSlug]) {
    return BUILTIN_ROLE_TEMPLATES[roleSlug].permissions;
  }
  const custom = (customRoles || []).find(r => r.slug === roleSlug || r.id === roleSlug);
  return custom ? (custom.permissions || []) : [];
}

export function hasPermission(actorPermissions = [], required) {
  if (actorPermissions.includes('*') || actorPermissions.includes('all')) return true;
  return actorPermissions.includes(required);
}

export function validateCustomRolePermissions({
  actorRole,
  actorPermissions = [],
  targetScope = 'location',
  requestedPermissions = []
} = {}) {
  const perms = Array.isArray(requestedPermissions) ? requestedPermissions : [];
  for (const p of perms) {
    if (p === '*' && actorRole !== 'owner') {
      return { valid: false, code: 'ESCALATION_DENIED', error: 'Only an Agency Owner can grant wildcard permissions.' };
    }
    if (p !== '*' && !ALL_PERMISSIONS.includes(p)) {
      return { valid: false, code: 'UNKNOWN_PERMISSION', error: `Unknown permission: ${p}` };
    }
    if (targetScope === 'location' && AGENCY_ADMIN_ONLY_PERMISSIONS.has(p)) {
      return {
        valid: false,
        code: 'SCOPE_ESCALATION_DENIED',
        error: `Location-scoped roles cannot include agency-wide administrative permission '${p}'.`
      };
    }
    if (!hasPermission(actorPermissions, p)) {
      return {
        valid: false,
        code: 'ESCALATION_DENIED',
        error: `Cannot grant permission '${p}' that you do not possess.`
      };
    }
  }
  return { valid: true, permissions: Array.from(new Set(perms)) };
}

export function generateInvitationToken() {
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = hashInvitationToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashInvitationToken(rawToken) {
  return createHash('sha256').update(String(rawToken || '')).digest('hex');
}

export function verifyInvitationRecord(invite, { expectedAgencyId = null, acceptingEmail = null, now = new Date() } = {}) {
  if (!invite) {
    return { valid: false, code: 'INVITATION_NOT_FOUND', error: 'Invitation not found.' };
  }
  if (expectedAgencyId && (invite.agency_id || invite.agencyId) !== expectedAgencyId) {
    return { valid: false, code: 'INVITATION_AGENCY_MISMATCH', error: 'Invitation belongs to a different agency.' };
  }
  if (invite.status === 'revoked' || invite.revoked_at || invite.revokedAt) {
    return { valid: false, code: 'INVITATION_REVOKED', error: 'Invitation has been revoked.' };
  }
  if (invite.status === 'accepted' || invite.accepted_at || invite.acceptedAt) {
    return { valid: false, code: 'INVITATION_ALREADY_ACCEPTED', error: 'Invitation has already been accepted.' };
  }
  if (invite.status === 'declined') {
    return { valid: false, code: 'INVITATION_DECLINED', error: 'Invitation was declined.' };
  }
  const exp = invite.expires_at || invite.expiresAt;
  if (exp && new Date(exp).getTime() <= now.getTime()) {
    return { valid: false, code: 'INVITATION_EXPIRED', error: 'Invitation has expired.' };
  }
  if (acceptingEmail && String(invite.email).toLowerCase().trim() !== String(acceptingEmail).toLowerCase().trim()) {
    return { valid: false, code: 'INVITATION_EMAIL_MISMATCH', error: 'Invitation email does not match authenticated user.' };
  }
  return { valid: true };
}

export function assertOwnerProtected({ activeOwnerCount, targetCurrentRole, targetNextRole = null, deactivating = false }) {
  if (targetCurrentRole === 'owner' && (deactivating || (targetNextRole && targetNextRole !== 'owner')) && activeOwnerCount <= 1) {
    throw Object.assign(
      new Error('Cannot deactivate or demote the last active Agency Owner.'),
      { code: 'LAST_OWNER_PROTECTED', status: 409 }
    );
  }
}

export function computeOnboardingProgress({ agency, locations = [], members = [], onboardingState = {} } = {}) {
  const steps = [
    {
      id: 'agency_profile',
      label: 'Complete agency profile',
      completed: Boolean(agency?.name && (agency?.email || agency?.website))
    },
    {
      id: 'regional_defaults',
      label: 'Configure default timezone and currency',
      completed: Boolean((agency?.default_timezone || agency?.defaultTimezone) && (agency?.default_currency || agency?.defaultCurrency))
    },
    {
      id: 'primary_location',
      label: 'Create primary location',
      completed: locations.some(l => l.status === 'active')
    },
    {
      id: 'team_and_roles',
      label: 'Invite team or review role permissions',
      completed: members.length > 1 || (onboardingState?.completedSteps || []).includes('team_and_roles')
    },
    {
      id: 'security_review',
      label: 'Review workspace security & sessions',
      completed: (onboardingState?.completedSteps || []).includes('security_review')
    }
  ];
  const completedCount = steps.filter(s => s.completed).length;
  return {
    steps,
    completedCount,
    totalCount: steps.length,
    percent: Math.round((completedCount / steps.length) * 100),
    dismissed: Boolean(onboardingState?.dismissed)
  };
}
