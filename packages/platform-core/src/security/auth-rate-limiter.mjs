/**
 * Phase 8.1 — Layered Authentication Rate Limiter
 * Enforces both IP-based and identifier-based limits across login, OTP,
 * password reset, and OAuth endpoints. Supports trusted-proxy validation,
 * optional distributed Redis store, safe fallback, Retry-After headers,
 * and non-permanent sliding windows (prevents account-lockout DoS).
 */

import { createHash } from 'node:crypto';

const DEFAULT_POLICIES = Object.freeze({
  login: { ipMax: 20, idMax: 8, windowMs: 60_000 },
  otp_request: { ipMax: 10, idMax: 5, windowMs: 300_000 },
  otp_verify: { ipMax: 15, idMax: 6, windowMs: 300_000 },
  password_reset: { ipMax: 10, idMax: 5, windowMs: 300_000 },
  oauth_authorize: { ipMax: 30, idMax: 15, windowMs: 60_000 },
  oauth_token: { ipMax: 30, idMax: 20, windowMs: 60_000 }
});

export function extractTrustedClientIp(req, {
  trustProxy = false,
  trustedProxies = ['127.0.0.1', '::1', '::ffff:127.0.0.1']
} = {}) {
  const remoteAddr = String(req?.socket?.remoteAddress || req?.remoteAddress || '0.0.0.0').trim();
  if (!trustProxy || !trustedProxies.includes(remoteAddr)) {
    return remoteAddr;
  }
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    const firstHop = xff.split(',')[0].trim();
    if (firstHop) return firstHop;
  }
  const xRealIp = req?.headers?.['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.trim()) {
    return xRealIp.trim();
  }
  return remoteAddr;
}

function hashIdentifier(value) {
  return createHash('sha256').update(String(value || '').toLowerCase().trim()).digest('hex').slice(0, 16);
}

export function createAuthRateLimiter({
  policies = DEFAULT_POLICIES,
  redisClient = null,
  trustProxy = false,
  trustedProxies = ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
  auditSink = null
} = {}) {
  const buckets = new Map(); // key -> number[] timestamps

  async function incrementCounter(key, windowMs, now) {
    if (redisClient && typeof redisClient.incr === 'function') {
      try {
        const count = await redisClient.incr(key);
        if (count === 1 && typeof redisClient.pexpire === 'function') {
          await redisClient.pexpire(key, windowMs);
        }
        return { count, retryAfterSec: Math.ceil(windowMs / 1000), backend: 'redis' };
      } catch {
        // Fall back safely to in-memory window if Redis is transiently unavailable
      }
    }

    const cutoff = now - windowMs;
    const recent = (buckets.get(key) || []).filter((ts) => ts > cutoff);
    recent.push(now);
    buckets.set(key, recent);
    const oldest = recent[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { count: recent.length, retryAfterSec, backend: 'memory' };
  }

  async function check({
    action = 'login',
    req = null,
    identifier = null,
    now = Date.now()
  } = {}) {
    const policy = policies[action] || DEFAULT_POLICIES.login;
    const clientIp = extractTrustedClientIp(req, { trustProxy, trustedProxies });
    const ipKey = `rl:${action}:ip:${clientIp}`;
    const ipRes = await incrementCounter(ipKey, policy.windowMs, now);

    if (ipRes.count > policy.ipMax) {
      auditSink?.({
        event: 'auth.rate_limited',
        action,
        scope: 'ip',
        ip: clientIp,
        retryAfterSec: ipRes.retryAfterSec
      });
      return {
        allowed: false,
        code: 'AUTH_RATE_LIMITED',
        scope: 'ip',
        retryAfterSec: ipRes.retryAfterSec,
        backend: ipRes.backend
      };
    }

    if (identifier && String(identifier).trim()) {
      const idHash = hashIdentifier(identifier);
      const idKey = `rl:${action}:id:${idHash}`;
      const idRes = await incrementCounter(idKey, policy.windowMs, now);
      if (idRes.count > policy.idMax) {
        auditSink?.({
          event: 'auth.rate_limited',
          action,
          scope: 'identifier',
          identifierHash: idHash,
          retryAfterSec: idRes.retryAfterSec
        });
        return {
          allowed: false,
          code: 'AUTH_RATE_LIMITED',
          scope: 'identifier',
          retryAfterSec: idRes.retryAfterSec,
          backend: idRes.backend
        };
      }
    }

    return { allowed: true, backend: ipRes.backend };
  }

  return { check };
}
