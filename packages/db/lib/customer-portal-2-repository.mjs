import { randomUUID } from 'node:crypto';
import {
  generatePortalToken,
  hashPortalToken,
  verifyMagicLinkRecord,
  verifyPortalSessionRecord,
  canTransitionPortalRequest
} from '../../platform-core/src/customer-portal-2-0.mjs';

function scope(tx, agencyId, locationId) {
  const a = agencyId || tx?.agencyId;
  const l = locationId || tx?.locationId;
  if (!a || !l) throw new Error('CustomerPortal2Repository requires agencyId and locationId');
  return { agencyId: a, locationId: l };
}

export function createCustomerPortal2Repository() {
  return {
    async getConfig(tx, { agencyId, locationId } = {}) {
      const s = scope(tx, agencyId, locationId);
      const res = await tx.query(
        `SELECT * FROM customer_portal_configs WHERE agency_id = $1 AND location_id = $2`,
        [s.agencyId, s.locationId]
      );
      return res.rows[0] || null;
    },

    async upsertConfig(tx, input = {}) {
      const s = scope(tx, input.agencyId, input.locationId);
      const res = await tx.query(
        `INSERT INTO customer_portal_configs (
          agency_id, location_id, id, enabled, portal_name, welcome_message,
          support_email, branding, allowed_features, editable_profile_fields, custom_domain_id, updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)
        ON CONFLICT (agency_id, location_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          portal_name = EXCLUDED.portal_name,
          welcome_message = EXCLUDED.welcome_message,
          support_email = EXCLUDED.support_email,
          branding = EXCLUDED.branding,
          allowed_features = EXCLUDED.allowed_features,
          editable_profile_fields = EXCLUDED.editable_profile_fields,
          custom_domain_id = EXCLUDED.custom_domain_id,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        RETURNING *`,
        [
          s.agencyId,
          s.locationId,
          randomUUID(),
          Boolean(input.enabled),
          String(input.portalName || 'Customer Portal').trim(),
          String(input.welcomeMessage || 'Welcome to your client portal.'),
          input.supportEmail || null,
          JSON.stringify(input.branding || {}),
          JSON.stringify(input.allowedFeatures || { appointments: true, messages: true, orders: true, invoices: true, documents: true, preferences: true }),
          JSON.stringify(input.editableProfileFields || ['firstName', 'lastName', 'phone', 'company', 'timezone', 'preferredLanguage']),
          input.customDomainId || null,
          input.updatedBy || tx?.actorId || 'system'
        ]
      );
      return res.rows[0];
    },

    async issueMagicLink(tx, { agencyId, locationId, contactId, email, ttlMinutes = 15 } = {}) {
      const s = scope(tx, agencyId, locationId);
      const { rawToken, tokenHash } = generatePortalToken();
      const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlMinutes)) * 60_000).toISOString();
      await tx.query(
        `INSERT INTO customer_portal_magic_links (
          agency_id, location_id, id, contact_id, email, token_hash, expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [s.agencyId, s.locationId, randomUUID(), contactId, String(email).trim().toLowerCase(), tokenHash, expiresAt]
      );
      return { rawToken, expiresAt };
    },

    async consumeMagicLink(tx, { agencyId, locationId, rawToken, sessionTtlHours = 24 } = {}) {
      const s = scope(tx, agencyId, locationId);
      const tokenHash = hashPortalToken(rawToken);
      const linkRes = await tx.query(
        `SELECT * FROM customer_portal_magic_links
         WHERE agency_id = $1 AND location_id = $2 AND token_hash = $3 FOR UPDATE`,
        [s.agencyId, s.locationId, tokenHash]
      );
      const link = linkRes.rows[0];
      const check = verifyMagicLinkRecord(link, { expectedAgencyId: s.agencyId });
      if (!check.valid) {
        throw Object.assign(new Error(`Magic link invalid: ${check.code}`), { code: check.code });
      }
      await tx.query(
        `UPDATE customer_portal_magic_links SET consumed_at = now() WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [s.agencyId, s.locationId, link.id]
      );

      const session = generatePortalToken();
      const sessionExpires = new Date(Date.now() + Number(sessionTtlHours) * 3600_000).toISOString();
      await tx.query(
        `INSERT INTO customer_portal_sessions (
          agency_id, location_id, id, contact_id, session_token_hash, expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [s.agencyId, s.locationId, randomUUID(), link.contact_id, session.tokenHash, sessionExpires]
      );
      return {
        sessionToken: session.rawToken,
        expiresAt: sessionExpires,
        contactId: link.contact_id,
        role: 'external_customer'
      };
    },

    async authenticateSession(tx, { agencyId, locationId, rawSessionToken } = {}) {
      const s = scope(tx, agencyId, locationId);
      const tokenHash = hashPortalToken(rawSessionToken);
      const res = await tx.query(
        `SELECT * FROM customer_portal_sessions
         WHERE agency_id = $1 AND location_id = $2 AND session_token_hash = $3`,
        [s.agencyId, s.locationId, tokenHash]
      );
      const check = verifyPortalSessionRecord(res.rows[0], { expectedAgencyId: s.agencyId });
      if (!check.valid) {
        throw Object.assign(new Error(`Portal session invalid: ${check.code}`), { code: check.code });
      }
      return check;
    },

    async revokeSession(tx, { agencyId, locationId, rawSessionToken } = {}) {
      const s = scope(tx, agencyId, locationId);
      const tokenHash = hashPortalToken(rawSessionToken);
      await tx.query(
        `UPDATE customer_portal_sessions SET revoked_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND session_token_hash = $3`,
        [s.agencyId, s.locationId, tokenHash]
      );
      return { revoked: true };
    },

    async listRequests(tx, { agencyId, locationId, contactId = null } = {}) {
      const s = scope(tx, agencyId, locationId);
      const params = [s.agencyId, s.locationId];
      let where = 'agency_id = $1 AND location_id = $2';
      if (contactId) {
        params.push(contactId);
        where += ` AND contact_id = $${params.length}`;
      }
      const res = await tx.query(`SELECT * FROM customer_portal_requests WHERE ${where} ORDER BY created_at DESC`, params);
      return res.rows;
    },

    async createRequest(tx, { agencyId, locationId, contactId, requestType, payload = {} } = {}) {
      const s = scope(tx, agencyId, locationId);
      const res = await tx.query(
        `INSERT INTO customer_portal_requests (
          agency_id, location_id, id, contact_id, request_type, status, payload
        ) VALUES ($1,$2,$3,$4,$5,'requested',$6::jsonb)
        RETURNING *`,
        [s.agencyId, s.locationId, randomUUID(), contactId, requestType, JSON.stringify(payload)]
      );
      return res.rows[0];
    },

    async transitionRequest(tx, { agencyId, locationId, requestId, toStatus, resolutionNote = null, actorId = 'system' } = {}) {
      const s = scope(tx, agencyId, locationId);
      const cur = await tx.query(
        `SELECT * FROM customer_portal_requests WHERE agency_id = $1 AND location_id = $2 AND id = $3 FOR UPDATE`,
        [s.agencyId, s.locationId, requestId]
      );
      if (cur.rows.length === 0) return null;
      if (!canTransitionPortalRequest(cur.rows[0].status, toStatus)) {
        throw Object.assign(new Error(`Invalid request transition: ${cur.rows[0].status} -> ${toStatus}`), {
          code: 'INVALID_REQUEST_TRANSITION'
        });
      }
      const upd = await tx.query(
        `UPDATE customer_portal_requests
         SET status = $4, resolution_note = COALESCE($5, resolution_note), reviewed_by = $6, reviewed_at = now(), updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [s.agencyId, s.locationId, requestId, toStatus, resolutionNote, actorId]
      );
      return upd.rows[0];
    }
  };
}
