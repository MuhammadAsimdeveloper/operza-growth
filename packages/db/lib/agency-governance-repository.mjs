/**
 * ============================================================================
 * Operza Agency Governance 2.0 Repository — TenantTx & FORCE RLS Boundary
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import {
  BUILTIN_ROLE_TEMPLATES,
  assertOwnerProtected,
  computeOnboardingProgress,
  generateInvitationToken,
  hashInvitationToken,
  validateCustomRolePermissions,
  verifyInvitationRecord
} from '../../platform-core/src/agency-governance-2-0.mjs';

function parseJson(val, fallback) {
  if (val == null) return fallback;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return val;
}

function iso(val) {
  return val?.toISOString?.() || val || null;
}

export function createAgencyGovernanceRepository() {
  return {
    async getAgencyWorkspace(tx) {
      const res = await tx.query(`SELECT * FROM agencies WHERE id = $1`, [tx.agencyId]);
      if (res.rows.length === 0) return null;
      const a = res.rows[0];
      return {
        id: a.id,
        name: a.name,
        slug: a.slug,
        status: a.status,
        email: a.email || '',
        phone: a.phone || '',
        website: a.website || '',
        category: a.category || '',
        logoUrl: a.logo_url || '',
        address: parseJson(a.address, {}),
        country: a.country || 'US',
        defaultLanguage: a.default_language || 'en',
        defaultTimezone: a.default_timezone || 'UTC',
        defaultCurrency: a.default_currency || 'USD',
        regionalPreferences: parseJson(a.regional_preferences, {}),
        onboardingState: parseJson(a.onboarding_state, { completedSteps: [], dismissed: false }),
        createdAt: iso(a.created_at),
        updatedAt: iso(a.updated_at)
      };
    },

    async updateAgencyWorkspace(tx, patch = {}) {
      if (patch.slug) {
        const slugClean = String(patch.slug).trim().toLowerCase();
        if (!/^[a-z0-9-]{2,80}$/.test(slugClean)) {
          throw Object.assign(new Error('Workspace identifier must be 2-80 lowercase alphanumeric characters or hyphens.'), {
            code: 'INVALID_SLUG',
            status: 400
          });
        }
        const dup = await tx.query(`SELECT id FROM agencies WHERE slug = $1 AND id <> $2`, [slugClean, tx.agencyId]);
        if (dup.rows.length > 0) {
          throw Object.assign(new Error('Workspace identifier is already in use.'), {
            code: 'DUPLICATE_WORKSPACE_SLUG',
            status: 409
          });
        }
        patch.slug = slugClean;
      }

      try {
        const res = await tx.query(
          `UPDATE agencies
           SET name = COALESCE($1, name),
               slug = COALESCE($2, slug),
               email = COALESCE($3, email),
               phone = COALESCE($4, phone),
               website = COALESCE($5, website),
               category = COALESCE($6, category),
               logo_url = COALESCE($7, logo_url),
               address = COALESCE($8::jsonb, address),
               country = COALESCE($9, country),
               default_language = COALESCE($10, default_language),
               default_timezone = COALESCE($11, default_timezone),
               default_currency = COALESCE($12, default_currency),
               regional_preferences = COALESCE($13::jsonb, regional_preferences),
               updated_at = now()
           WHERE id = $14
           RETURNING *`,
          [
            patch.name ?? null,
            patch.slug ?? null,
            patch.email ?? null,
            patch.phone ?? null,
            patch.website ?? null,
            patch.category ?? null,
            patch.logoUrl ?? null,
            patch.address ? JSON.stringify(patch.address) : null,
            patch.country ?? null,
            patch.defaultLanguage ?? null,
            patch.defaultTimezone ?? null,
            patch.defaultCurrency ?? null,
            patch.regionalPreferences ? JSON.stringify(patch.regionalPreferences) : null,
            tx.agencyId
          ]
        );
        return res.rows[0] ? this.getAgencyWorkspace(tx) : null;
      } catch (err) {
        if (err.code === '23505') {
          throw Object.assign(new Error('Workspace identifier is already in use.'), {
            code: 'DUPLICATE_WORKSPACE_SLUG',
            status: 409
          });
        }
        throw err;
      }
    },

    async listLocations(tx) {
      const res = await tx.query(
        `SELECT * FROM locations WHERE agency_id = $1 ORDER BY created_at ASC`,
        [tx.agencyId]
      );
      return res.rows.map(l => ({
        id: l.id,
        agencyId: l.agency_id,
        name: l.name,
        timezone: l.timezone,
        status: l.status,
        address: parseJson(l.address, {}),
        phone: l.phone || '',
        email: l.email || '',
        preferences: parseJson(l.preferences, {}),
        archivedAt: iso(l.archived_at),
        createdAt: iso(l.created_at)
      }));
    },

    async createLocation(tx, data = {}) {
      const name = String(data.name || '').trim();
      if (name.length < 2 || name.length > 100) {
        throw Object.assign(new Error('Location name must be 2-100 characters.'), { code: 'INVALID_LOCATION_NAME', status: 400 });
      }
      const res = await tx.query(
        `INSERT INTO locations (id, agency_id, name, timezone, status, address, phone, email, preferences)
         VALUES ($1, $2, $3, $4, 'active', $5::jsonb, $6, $7, $8::jsonb)
         RETURNING *`,
        [
          randomUUID(), tx.agencyId, name, data.timezone || 'UTC',
          JSON.stringify(data.address || {}), data.phone || null, data.email || null,
          JSON.stringify(data.preferences || {})
        ]
      );
      return res.rows[0];
    },

    async updateLocation(tx, locationId, data = {}) {
      const res = await tx.query(
        `UPDATE locations
         SET name = COALESCE($1, name),
             timezone = COALESCE($2, timezone),
             address = COALESCE($3::jsonb, address),
             phone = COALESCE($4, phone),
             email = COALESCE($5, email),
             preferences = COALESCE($6::jsonb, preferences),
             updated_at = now()
         WHERE agency_id = $7 AND id = $8
         RETURNING *`,
        [
          data.name ?? null, data.timezone ?? null,
          data.address ? JSON.stringify(data.address) : null,
          data.phone ?? null, data.email ?? null,
          data.preferences ? JSON.stringify(data.preferences) : null,
          tx.agencyId, locationId
        ]
      );
      return res.rows[0] || null;
    },

    async setLocationStatus(tx, locationId, status) {
      if (!['active', 'inactive'].includes(status)) {
        throw Object.assign(new Error('Invalid location status.'), { code: 'INVALID_STATUS', status: 400 });
      }
      const res = await tx.query(
        `UPDATE locations
         SET status = $1,
             archived_at = CASE WHEN $1 = 'inactive' THEN now() ELSE NULL END,
             updated_at = now()
         WHERE agency_id = $2 AND id = $3
         RETURNING *`,
        [status, tx.agencyId, locationId]
      );
      return res.rows[0] || null;
    },

    async listTeamMembers(tx, { search = '', status = 'all' } = {}) {
      const res = await tx.query(
        `SELECT m.*, u.name AS user_name, u.email AS user_email
         FROM agency_memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.agency_id = $1
         ORDER BY m.created_at ASC`,
        [tx.agencyId]
      );
      const locMemberships = await tx.query(
        `SELECT user_id, location_id, status FROM user_location_memberships WHERE agency_id = $1 AND status = 'active'`,
        [tx.agencyId]
      );
      const locMap = new Map();
      for (const row of locMemberships.rows) {
        const list = locMap.get(row.user_id) || [];
        list.push(row.location_id);
        locMap.set(row.user_id, list);
      }

      return res.rows
        .map(m => ({
          id: m.id,
          userId: m.user_id,
          name: m.user_name,
          email: m.user_email,
          role: m.role,
          customRoleId: m.custom_role_id || null,
          status: m.status,
          locationIds: locMap.get(m.user_id) || [],
          lastActiveAt: iso(m.last_active_at),
          offboardedAt: iso(m.offboarded_at),
          createdAt: iso(m.created_at)
        }))
        .filter(m => {
          if (status !== 'all' && m.status !== status) return false;
          if (search) {
            const q = search.toLowerCase();
            if (!m.name.toLowerCase().includes(q) && !m.email.toLowerCase().includes(q)) return false;
          }
          return true;
        });
    },

    async setMemberLocationAccess(tx, { userId, locationIds = [], actorId }) {
      await tx.query(
        `UPDATE user_location_memberships SET status = 'inactive', updated_at = now()
         WHERE agency_id = $1 AND user_id = $2`,
        [tx.agencyId, userId]
      );
      for (const locId of locationIds) {
        await tx.query(
          `INSERT INTO user_location_memberships (agency_id, location_id, user_id, status, granted_by)
           VALUES ($1, $2, $3, 'active', $4)
           ON CONFLICT (agency_id, location_id, user_id) DO UPDATE
           SET status = 'active', granted_by = EXCLUDED.granted_by, updated_at = now()`,
          [tx.agencyId, locId, userId, actorId]
        );
      }
      return { success: true, userId, locationIds };
    },

    async assertUserHasLocationAccess(tx, { userId, locationId }) {
      const memRes = await tx.query(
        `SELECT role, status FROM agency_memberships WHERE agency_id = $1 AND user_id = $2 AND status = 'active'`,
        [tx.agencyId, userId]
      );
      if (memRes.rows.length === 0) return false;
      const role = memRes.rows[0].role;
      if (role === 'owner' || role === 'admin') return true;
      const locRes = await tx.query(
        `SELECT 1 FROM user_location_memberships
         WHERE agency_id = $1 AND location_id = $2 AND user_id = $3 AND status = 'active'`,
        [tx.agencyId, locationId, userId]
      );
      return locRes.rows.length > 0;
    },

    async updateMemberRole(tx, { userId, role, customRoleId = null, actorRole }) {
      if (role === 'owner' && actorRole !== 'owner') {
        throw Object.assign(new Error('Only an Agency Owner can assign owner privileges.'), { code: 'ESCALATION_DENIED', status: 403 });
      }
      const allRes = await tx.query(
        `SELECT user_id, role FROM agency_memberships WHERE agency_id = $1 AND status = 'active' FOR UPDATE`,
        [tx.agencyId]
      );
      const target = allRes.rows.find(r => r.user_id === userId);
      if (!target) return null;
      const activeOwnerCount = allRes.rows.filter(r => r.role === 'owner').length;
      assertOwnerProtected({ activeOwnerCount, targetCurrentRole: target.role, targetNextRole: role });

      const upd = await tx.query(
        `UPDATE agency_memberships
         SET role = $1, custom_role_id = $2, updated_at = now()
         WHERE agency_id = $3 AND user_id = $4
         RETURNING *`,
        [role, customRoleId, tx.agencyId, userId]
      );
      return upd.rows[0];
    },

    async offboardMember(tx, { userId, actorId }) {
      const allRes = await tx.query(
        `SELECT user_id, role FROM agency_memberships WHERE agency_id = $1 AND status = 'active' FOR UPDATE`,
        [tx.agencyId]
      );
      const target = allRes.rows.find(r => r.user_id === userId);
      if (!target) return { notFound: true };
      const activeOwnerCount = allRes.rows.filter(r => r.role === 'owner').length;
      assertOwnerProtected({ activeOwnerCount, targetCurrentRole: target.role, deactivating: true });

      await tx.query(
        `UPDATE agency_memberships
         SET status = 'inactive', offboarded_at = now(), offboarded_by = $1, updated_at = now()
         WHERE agency_id = $2 AND user_id = $3`,
        [actorId, tx.agencyId, userId]
      );
      await tx.query(
        `UPDATE user_location_memberships
         SET status = 'inactive', updated_at = now()
         WHERE agency_id = $1 AND user_id = $2`,
        [tx.agencyId, userId]
      );
      const revokedSessions = await tx.query(
        `UPDATE auth_sessions
         SET revoked_at = now(), revoked_by = $1
         WHERE agency_id = $2 AND user_id = $3 AND revoked_at IS NULL`,
        [actorId, tx.agencyId, userId]
      );
      return { success: true, userId, revokedSessionsCount: revokedSessions.rowCount };
    },

    async createInvitation(tx, { email, role = 'member', locationIds = [], customRoleId = null, expiresInHours = 72, invitedBy }) {
      const cleanEmail = String(email || '').toLowerCase().trim();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        throw Object.assign(new Error('Valid invitation email is required.'), { code: 'INVALID_EMAIL', status: 400 });
      }
      if (!['admin', 'member', 'viewer'].includes(role)) {
        throw Object.assign(new Error('Invitation role must be admin, member, or viewer.'), { code: 'INVALID_ROLE', status: 400 });
      }
      const { rawToken, tokenHash } = generateInvitationToken();
      const expiresAt = new Date(Date.now() + Math.min(720, Math.max(1, Number(expiresInHours) || 72)) * 3600_000);
      const id = randomUUID();
      const res = await tx.query(
        `INSERT INTO agency_invitations (
          id, agency_id, email, role, status, invited_by, token_hash, location_ids, custom_role_id, expires_at, delivery_status
        ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7::jsonb, $8, $9, 'pending_local')
        RETURNING *`,
        [id, tx.agencyId, cleanEmail, role, invitedBy, tokenHash, JSON.stringify(locationIds), customRoleId, expiresAt]
      );
      return { invitation: res.rows[0], rawToken };
    },

    async listInvitations(tx) {
      const res = await tx.query(
        `SELECT id, agency_id, email, role, status, invited_by, location_ids, custom_role_id, expires_at, accepted_at, revoked_at, delivery_status, created_at
         FROM agency_invitations WHERE agency_id = $1 ORDER BY created_at DESC`,
        [tx.agencyId]
      );
      return res.rows;
    },

    async revokeInvitation(tx, { inviteId, actorId }) {
      const res = await tx.query(
        `UPDATE agency_invitations
         SET status = 'revoked', revoked_at = now(), revoked_by = $1, updated_at = now()
         WHERE agency_id = $2 AND id = $3 AND status = 'pending'
         RETURNING id, email, status, revoked_at`,
        [actorId, tx.agencyId, inviteId]
      );
      return res.rows[0] || null;
    },

    async acceptInvitation(tx, { rawToken, acceptingUserId, acceptingEmail }) {
      const tokenHash = hashInvitationToken(rawToken);
      const invRes = await tx.query(
        `SELECT * FROM agency_invitations WHERE agency_id = $1 AND token_hash = $2 FOR UPDATE`,
        [tx.agencyId, tokenHash]
      );
      const invite = invRes.rows[0] || null;
      const check = verifyInvitationRecord(invite, { expectedAgencyId: tx.agencyId, acceptingEmail });
      if (!check.valid) {
        throw Object.assign(new Error(check.error), { code: check.code, status: 409 });
      }

      await tx.query(
        `UPDATE agency_invitations
         SET status = 'accepted', accepted_at = now(), accepted_by_user_id = $1, updated_at = now()
         WHERE agency_id = $2 AND id = $3`,
        [acceptingUserId, tx.agencyId, invite.id]
      );

      await tx.query(
        `INSERT INTO agency_memberships (id, agency_id, user_id, role, custom_role_id, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (agency_id, user_id) DO UPDATE
         SET role = EXCLUDED.role, custom_role_id = EXCLUDED.custom_role_id, status = 'active', offboarded_at = NULL, updated_at = now()`,
        [randomUUID(), tx.agencyId, acceptingUserId, invite.role, invite.custom_role_id]
      );

      const locIds = parseJson(invite.location_ids, []);
      for (const locId of locIds) {
        await tx.query(
          `INSERT INTO user_location_memberships (agency_id, location_id, user_id, status, granted_by)
           VALUES ($1, $2, $3, 'active', $4)
           ON CONFLICT (agency_id, location_id, user_id) DO UPDATE SET status = 'active', updated_at = now()`,
          [tx.agencyId, locId, acceptingUserId, invite.invited_by]
        );
      }
      return { success: true, inviteId: invite.id, role: invite.role, locationIds: locIds };
    },

    async listRoles(tx) {
      const res = await tx.query(
        `SELECT * FROM agency_roles WHERE agency_id = $1 AND archived = false ORDER BY is_system DESC, name ASC`,
        [tx.agencyId]
      );
      const customRoles = res.rows.map(r => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        scope: r.scope,
        permissions: parseJson(r.permissions, []),
        isSystem: Boolean(r.is_system)
      }));
      return {
        builtinRoles: Object.values(BUILTIN_ROLE_TEMPLATES),
        customRoles
      };
    },

    async createCustomRole(tx, { name, description = '', scope = 'location', permissions = [], actorRole, actorPermissions = [], actorId }) {
      const check = validateCustomRolePermissions({ actorRole, actorPermissions, targetScope: scope, requestedPermissions: permissions });
      if (!check.valid) {
        throw Object.assign(new Error(check.error), { code: check.code, status: 403 });
      }
      const cleanName = String(name || '').trim();
      const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      if (BUILTIN_ROLE_TEMPLATES[slug]) {
        throw Object.assign(new Error('Cannot override built-in role slug.'), { code: 'PROTECTED_ROLE_SLUG', status: 409 });
      }
      const res = await tx.query(
        `INSERT INTO agency_roles (id, agency_id, name, slug, description, scope, permissions, is_system, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, false, $8)
         RETURNING *`,
        [randomUUID(), tx.agencyId, cleanName, slug, description, scope, JSON.stringify(check.permissions), actorId]
      );
      return res.rows[0];
    },

    async listActiveSessions(tx) {
      const res = await tx.query(
        `SELECT s.id, s.user_id, u.name AS user_name, u.email AS user_email, s.user_agent, s.last_seen_at, s.expires_at, s.revoked_at, s.created_at
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.agency_id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
         ORDER BY s.created_at DESC`,
        [tx.agencyId]
      );
      return res.rows.map(s => ({
        id: s.id,
        userId: s.user_id,
        userName: s.user_name,
        userEmail: s.user_email,
        userAgent: s.user_agent || 'Browser session',
        lastSeenAt: iso(s.last_seen_at),
        expiresAt: iso(s.expires_at),
        createdAt: iso(s.created_at)
      }));
    },

    async revokeSession(tx, { sessionId, actorId }) {
      const res = await tx.query(
        `UPDATE auth_sessions SET revoked_at = now(), revoked_by = $1
         WHERE agency_id = $2 AND id = $3 AND revoked_at IS NULL
         RETURNING id, user_id, revoked_at`,
        [actorId, tx.agencyId, sessionId]
      );
      return res.rows[0] || null;
    },

    async getOnboardingSummary(tx) {
      const agency = await this.getAgencyWorkspace(tx);
      const locations = await this.listLocations(tx);
      const members = await this.listTeamMembers(tx, {});
      return computeOnboardingProgress({
        agency,
        locations,
        members,
        onboardingState: agency?.onboardingState
      });
    },

    async updateOnboardingState(tx, patch = {}) {
      const cur = await this.getAgencyWorkspace(tx);
      const next = {
        completedSteps: Array.isArray(patch.completedSteps) ? patch.completedSteps : (cur?.onboardingState?.completedSteps || []),
        dismissed: patch.dismissed !== undefined ? Boolean(patch.dismissed) : Boolean(cur?.onboardingState?.dismissed)
      };
      await tx.query(
        `UPDATE agencies SET onboarding_state = $1::jsonb, updated_at = now() WHERE id = $2`,
        [JSON.stringify(next), tx.agencyId]
      );
      return this.getOnboardingSummary(tx);
    }
  };
}
