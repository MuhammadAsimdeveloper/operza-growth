/**
 * Phase 6 — Custom Domains & SSL Certificates Repository (TenantTx)
 * Enforces global hostname uniqueness across tenants, DNS TXT ownership
 * verification, certificate metadata persistence (never storing private keys),
 * and clean disconnection.
 */

import { randomUUID } from 'node:crypto';
import {
  generateDomainVerificationToken,
  normalizeHostname,
  verifyDnsTxtOwnership
} from '../../platform-core/src/domains/custom-domains.mjs';

export function createCustomDomainsRepository() {
  return {
    async requestDomain(tx, {
      id = randomUUID(),
      siteId = null,
      hostname,
      isPrimary = false,
      ttlHours = 48
    } = {}) {
      const normalized = normalizeHostname(hostname);
      const token = generateDomainVerificationToken();
      const expiresAt = new Date(Date.now() + ttlHours * 3600_000);

      try {
        const res = await tx.query(
          `INSERT INTO custom_domains (
            agency_id, location_id, id, site_id, hostname, is_primary,
            status, verification_token, verification_expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'pending_verification', $7, $8)
          RETURNING *`,
          [tx.agencyId, tx.locationId, id, siteId, normalized, Boolean(isPrimary), token, expiresAt]
        );
        return res.rows[0];
      } catch (err) {
        if (err?.code === '23505') {
          throw Object.assign(new Error(`Domain '${normalized}' is already claimed`), {
            code: 'DOMAIN_ALREADY_CLAIMED'
          });
        }
        throw err;
      }
    },

    async getDomainById(tx, domainId) {
      const res = await tx.query(
        `SELECT * FROM custom_domains WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [tx.agencyId, tx.locationId, domainId]
      );
      return res.rows[0] || null;
    },

    async listDomains(tx, { siteId = null } = {}) {
      if (siteId) {
        const res = await tx.query(
          `SELECT * FROM custom_domains WHERE agency_id = $1 AND location_id = $2 AND site_id = $3 ORDER BY created_at DESC`,
          [tx.agencyId, tx.locationId, siteId]
        );
        return res.rows;
      }
      const res = await tx.query(
        `SELECT * FROM custom_domains WHERE agency_id = $1 AND location_id = $2 ORDER BY created_at DESC`,
        [tx.agencyId, tx.locationId]
      );
      return res.rows;
    },

    async verifyDomain(tx, domainId, { resolveTxt, now = Date.now() } = {}) {
      const domain = await this.getDomainById(tx, domainId);
      if (!domain || domain.status === 'disconnected') {
        throw Object.assign(new Error('Custom domain not found'), { code: 'DOMAIN_NOT_FOUND' });
      }

      const check = await verifyDnsTxtOwnership({
        hostname: domain.hostname,
        expectedToken: domain.verification_token,
        expiresAt: domain.verification_expires_at,
        now,
        resolveTxt
      });

      if (!check.verified) {
        await tx.query(
          `UPDATE custom_domains SET last_error = $4, updated_at = now()
           WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
          [tx.agencyId, tx.locationId, domainId, check.reason]
        );
        return { verified: false, code: check.code, reason: check.reason, domain };
      }

      const res = await tx.query(
        `UPDATE custom_domains
         SET status = 'verified', verified_at = now(), last_error = NULL, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [tx.agencyId, tx.locationId, domainId]
      );
      return { verified: true, matchedRecord: check.matchedRecord, domain: res.rows[0] };
    },

    async provisionSsl(tx, domainId, { sslAdapter, now = Date.now() } = {}) {
      const domain = await this.getDomainById(tx, domainId);
      if (!domain || !['verified', 'active', 'renewal_pending', 'certificate_pending'].includes(domain.status)) {
        throw Object.assign(new Error('Domain must be verified before provisioning SSL'), {
          code: 'DOMAIN_NOT_VERIFIED'
        });
      }

      const certResult = await sslAdapter.provision({ hostname: domain.hostname, now });
      const certId = randomUUID();

      await tx.query(
        `INSERT INTO ssl_certificates (
          agency_id, location_id, id, domain_id, provider, status,
          issuer, serial_number, issued_at, expires_at, last_error
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          tx.agencyId,
          tx.locationId,
          certId,
          domainId,
          sslAdapter.provider || 'acme_letsencrypt',
          certResult.status,
          certResult.issuer || null,
          certResult.serialNumber || null,
          certResult.issuedAt || null,
          certResult.expiresAt || null,
          certResult.ok ? null : (certResult.message || 'SSL provisioning failed')
        ]
      );

      if (!certResult.ok) {
        await tx.query(
          `UPDATE custom_domains SET status = 'certificate_pending', last_error = $4, updated_at = now()
           WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
          [tx.agencyId, tx.locationId, domainId, certResult.message]
        );
        return { ok: false, code: certResult.code, message: certResult.message, status: certResult.status };
      }

      const updated = await tx.query(
        `UPDATE custom_domains SET status = 'active', last_error = NULL, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [tx.agencyId, tx.locationId, domainId]
      );
      return { ok: true, domain: updated.rows[0], certificate: certResult };
    },

    async disconnectDomain(tx, domainId) {
      await tx.query(
        `UPDATE ssl_certificates SET status = 'disconnected', updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND domain_id = $3`,
        [tx.agencyId, tx.locationId, domainId]
      );
      const res = await tx.query(
        `UPDATE custom_domains SET status = 'disconnected', is_primary = false, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [tx.agencyId, tx.locationId, domainId]
      );
      return res.rows[0] || null;
    }
  };
}
