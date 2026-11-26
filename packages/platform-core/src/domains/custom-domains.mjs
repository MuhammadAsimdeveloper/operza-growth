/**
 * Phase 6 — Custom Domains, DNS TXT Ownership Verification, SSL Lifecycle & Host Routing
 * Enforces IDNA/hostname normalization, reserved-domain blocking, cryptographic challenge
 * verification, ACME/provider SSL issuance + HTTPS verification, and host-header safety.
 */

import { randomBytes } from 'node:crypto';
import dns from 'node:dns/promises';

const RESERVED_DOMAINS = new Set([
  'localhost',
  'operza.io',
  'www.operza.io',
  'app.operza.io',
  'api.operza.io',
  'admin.operza.io'
]);

const HOSTNAME_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeHostname(raw) {
  if (typeof raw !== 'string') {
    throw Object.assign(new TypeError('Hostname must be a string'), { code: 'INVALID_HOSTNAME' });
  }
  const trimmed = raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.+$/, '')
    .toLowerCase();

  if (!trimmed || trimmed.includes('*') || trimmed.includes('..') || trimmed.length > 253) {
    throw Object.assign(new TypeError('Malformed hostname'), { code: 'INVALID_HOSTNAME' });
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed) || trimmed.includes(':')) {
    throw Object.assign(new TypeError('IP literals are not allowed as custom domains'), { code: 'INVALID_HOSTNAME' });
  }

  let ascii;
  try {
    ascii = new URL(`http://${trimmed}`).hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    throw Object.assign(new TypeError('Invalid internationalized hostname'), { code: 'INVALID_HOSTNAME' });
  }

  const labels = ascii.split('.');
  if (labels.length < 2 || !labels.every((l) => HOSTNAME_LABEL_RE.test(l))) {
    throw Object.assign(new TypeError('Hostname does not conform to DNS label rules'), { code: 'INVALID_HOSTNAME' });
  }

  if (RESERVED_DOMAINS.has(ascii) || ascii.endsWith('.operza.io')) {
    throw Object.assign(new Error(`Domain '${ascii}' is reserved by the platform`), { code: 'RESERVED_HOSTNAME' });
  }

  return ascii;
}

export function generateDomainVerificationToken() {
  return `operza-verify-${randomBytes(16).toString('hex')}`;
}

export async function verifyDnsTxtOwnership({
  hostname,
  expectedToken,
  expiresAt,
  now = Date.now(),
  resolveTxt = (host) => dns.resolveTxt(host)
} = {}) {
  const normalized = normalizeHostname(hostname);
  if (!expectedToken || typeof expectedToken !== 'string') {
    return { verified: false, code: 'TOKEN_MISSING', reason: 'Verification token is missing' };
  }
  if (expiresAt && new Date(expiresAt).getTime() < now) {
    return { verified: false, code: 'TOKEN_EXPIRED', reason: 'Domain verification token has expired' };
  }

  const targets = [`_operza-challenge.${normalized}`, normalized];
  for (const target of targets) {
    try {
      const records = await resolveTxt(target);
      const flat = records.map((parts) => (Array.isArray(parts) ? parts.join('') : String(parts)));
      if (flat.some((val) => val.trim() === expectedToken)) {
        return { verified: true, matchedRecord: target };
      }
    } catch {
      // Try next DNS target
    }
  }

  return {
    verified: false,
    code: 'DNS_TXT_NOT_FOUND',
    reason: `Expected TXT record '${expectedToken}' not found at _operza-challenge.${normalized}`
  };
}

export function createSslProvisioningAdapter({
  provider = 'acme_letsencrypt',
  issueCertificate,
  verifyHttps
} = {}) {
  return {
    provider,
    async provision({ hostname, now = Date.now() } = {}) {
      const normalized = normalizeHostname(hostname);
      if (typeof issueCertificate !== 'function') {
        return {
          ok: false,
          status: 'provisioning_requested',
          code: 'SSL_PROVIDER_UNCONFIGURED',
          message: 'No live ACME/SSL provider configured'
        };
      }

      const issued = await issueCertificate({ hostname: normalized, now });
      if (!issued?.ok) {
        return {
          ok: false,
          status: 'renewal_failed',
          code: issued?.code || 'SSL_ISSUANCE_FAILED',
          message: issued?.message || 'Certificate issuance failed'
        };
      }

      // Never mark SSL active until serving path verifies HTTPS
      if (typeof verifyHttps !== 'function') {
        return {
          ok: false,
          status: 'issued',
          code: 'HTTPS_VERIFICATION_UNAVAILABLE',
          message: 'Certificate issued but HTTPS verification check is not configured'
        };
      }

      const httpsCheck = await verifyHttps({ hostname: normalized, certificate: issued });
      if (!httpsCheck?.ok) {
        return {
          ok: false,
          status: 'issued',
          code: httpsCheck?.code || 'HTTPS_VERIFICATION_FAILED',
          message: httpsCheck?.message || 'HTTPS verification failed for issued certificate'
        };
      }

      return {
        ok: true,
        status: 'active',
        provider,
        issuer: issued.issuer || "Let's Encrypt",
        serialNumber: issued.serialNumber || `sn_${randomBytes(8).toString('hex')}`,
        issuedAt: issued.issuedAt || new Date(now).toISOString(),
        expiresAt: issued.expiresAt || new Date(now + 90 * 86400_000).toISOString()
      };
    }
  };
}

export function resolvePublicHost({ rawHost, verifiedDomains = [] } = {}) {
  let normalized;
  try {
    normalized = normalizeHostname(String(rawHost || '').split(':')[0]);
  } catch {
    return null;
  }

  const match = verifiedDomains.find(
    (d) => d.status === 'active' && String(d.hostname || '').toLowerCase() === normalized
  );
  if (!match) return null;

  return {
    domainId: match.id,
    hostname: normalized,
    agencyId: match.agencyId,
    locationId: match.locationId,
    siteId: match.siteId
  };
}
