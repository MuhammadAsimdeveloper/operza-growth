import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

const PRIVATE_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'instance-data'
]);

const PRIVATE_IPV4_PATTERNS = [
  /^0\./,                                     // 0.0.0.0/8 Current network
  /^10\./,                                    // 10.0.0.0/8 Private network
  /^127\./,                                   // 127.0.0.0/8 Loopback
  /^169\.254\./,                              // 169.254.0.0/16 Link-local / Cloud metadata (169.254.169.254)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,          // 172.16.0.0/12 Private network
  /^192\.168\./,                              // 192.168.0.0/16 Private network
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // 100.64.0.0/10 Shared address space / CGNAT
  /^192\.0\.2\./,                             // TEST-NET-1
  /^198\.51\.100\./,                          // TEST-NET-2
  /^203\.0\.113\./,                           // TEST-NET-3
  /^224\./,                                   // Multicast
  /^240\./                                    // Reserved / Future use
];

export function isPrivateIpAddress(ip) {
  if (typeof ip !== 'string' || !net.isIP(ip)) {
    return false;
  }

  // IPv4 checks
  if (net.isIPv4(ip)) {
    return PRIVATE_IPV4_PATTERNS.some(pattern => pattern.test(ip));
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fe90:') || lower.startsWith('fea0:') || lower.startsWith('feb0:')) return true; // Link-local fe80::/10
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // Unique local fc00::/7
    if (lower.startsWith('ff')) return true; // Multicast ff00::/8

    // IPv4-mapped IPv6 (::ffff:192.168.1.1)
    if (lower.startsWith('::ffff:')) {
      const v4Part = lower.replace('::ffff:', '');
      if (net.isIPv4(v4Part)) {
        return isPrivateIpAddress(v4Part);
      }
    }
  }

  return false;
}

/**
 * Validates a target URL against SSRF vulnerabilities before attempting connection.
 */
export function assertSafeTargetUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) {
    throw Object.assign(new TypeError('Target URL is invalid or exceeds 2048 characters'), { code: 'INVALID_URL' });
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw Object.assign(new TypeError('Malformed target URL'), { code: 'MALFORMED_URL' });
  }

  if (parsed.protocol !== 'https:') {
    throw Object.assign(new Error(`Target protocol "${parsed.protocol}" is forbidden. HTTPS is strictly required.`), {
      code: 'HTTPS_REQUIRED'
    });
  }

  if (parsed.username || parsed.password) {
    throw Object.assign(new Error('URL credentials (userinfo) are strictly forbidden'), {
      code: 'URL_CREDENTIALS_FORBIDDEN'
    });
  }

  const hostname = parsed.hostname.replace(/[.]+$/, '').toLowerCase();

  // Hostname blacklists
  if (
    PRIVATE_HOSTS.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.test')
  ) {
    throw Object.assign(new Error(`Private or reserved target hostname "${hostname}" is forbidden`), {
      code: 'SSRF_PRIVATE_NETWORK_TARGET'
    });
  }

  // If hostname is directly an IP literal
  if (net.isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) {
      throw Object.assign(new Error(`Private IP literal target "${hostname}" is forbidden`), {
        code: 'SSRF_PRIVATE_IP_TARGET'
      });
    }
  }

  return {
    valid: true,
    hostname,
    url: parsed.href
  };
}

/**
 * DNS Pre-Pinning Resolver
 * Resolves the hostname, validates all resolved IPs against SSRF rules,
 * and pins to the first verified public IP to prevent DNS rebinding attacks.
 */
export async function prePinDnsLookup(hostname) {
  const normHost = hostname.replace(/[.]+$/, '').toLowerCase();

  if (
    PRIVATE_HOSTS.has(normHost) ||
    normHost.endsWith('.local') ||
    normHost.endsWith('.internal') ||
    normHost.endsWith('.localhost')
  ) {
    throw Object.assign(new Error(`SSRF blocked: hostname "${normHost}" is private`), {
      code: 'SSRF_PRIVATE_NETWORK_TARGET'
    });
  }

  if (net.isIP(normHost)) {
    if (isPrivateIpAddress(normHost)) {
      throw Object.assign(new Error(`SSRF blocked: IP "${normHost}" is in a private subnet`), {
        code: 'SSRF_PRIVATE_IP_TARGET'
      });
    }
    return normHost;
  }

  const results = await dns.lookup(normHost, { all: true });
  if (!results || results.length === 0) {
    throw Object.assign(new Error(`DNS resolution failed for hostname "${normHost}"`), {
      code: 'DNS_RESOLUTION_FAILED'
    });
  }

  for (const entry of results) {
    if (isPrivateIpAddress(entry.address)) {
      throw Object.assign(new Error(`SSRF blocked: hostname "${normHost}" resolved to private IP "${entry.address}"`), {
        code: 'SSRF_PRIVATE_IP_TARGET',
        resolvedIp: entry.address
      });
    }
  }

  // Return the first validated public IP
  return results[0].address;
}

/**
 * Generates deterministic idempotency keys for outbound provider calls.
 * Ensures that retries reuse the identical idempotency key to prevent double charging or sending duplicates.
 */
export function generateDeterministicIdempotencyKey({
  agencyId,
  locationId,
  actionHash,
  resourceId = null
}) {
  if (!agencyId || !locationId || !actionHash) {
    throw new TypeError('agencyId, locationId, and actionHash are required');
  }

  const input = `${agencyId}:${locationId}:${actionHash}:${resourceId || 'default'}`;
  const digest = crypto.createHash('sha256').update(input).digest('hex').slice(0, 32);

  return `opz_idem_${digest}`;
}

/**
 * Builds HTTP headers for outbound API provider dispatches with deterministic idempotency.
 */
export function buildProviderOutboundHeaders({
  agencyId,
  locationId,
  actionHash,
  resourceId = null,
  attempt = 1,
  extraHeaders = {}
} = {}) {
  const idempotencyKey = generateDeterministicIdempotencyKey({
    agencyId,
    locationId,
    actionHash,
    resourceId
  });

  return {
    'Idempotency-Key': idempotencyKey,
    'X-Idempotency-Key': idempotencyKey,
    'X-Operza-Attempt': String(attempt),
    'User-Agent': 'Operza-Provider-Fabric/2.0 (+https://operza.io)',
    ...extraHeaders
  };
}
