/**
 * ============================================================================
 * Operza OAuth 2.0 + PKCE & Credential Lifecycle Engine
 * ============================================================================
 * Provides generic PKCE S256 authorization initiation, strict redirect URI
 * allowlisting, single-use state validation, concurrent refresh locking,
 * refresh-token rotation, and terminal revocation. Never exposes tokens to
 * browser clients.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STATE_TTL_MS = 10 * 60 * 1000;

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function base64UrlSha256(value) {
  return createHash('sha256').update(value).digest('base64url');
}

export function createOAuthLifecycleEngine({
  stateKey = process.env.OPERZA_VAULT_KEY || '',
  allowedRedirectOrigins = [],
  secretResolver,
  fetchFn = globalThis.fetch,
  now = () => Date.now()
} = {}) {
  const pendingStates = new Map();
  const refreshLocks = new Map();

  function assertVaultKey() {
    if (typeof stateKey !== 'string' || stateKey.length < 16) {
      throw Object.assign(new Error('OPERZA_VAULT_KEY (>=16 chars) is required for OAuth state signing'), {
        code: 'OAUTH_VAULT_KEY_REQUIRED'
      });
    }
  }

  function validateRedirectUri(redirectUri) {
    let parsed;
    try {
      parsed = new URL(redirectUri);
    } catch {
      throw Object.assign(new TypeError('Invalid redirectUri'), { code: 'INVALID_REDIRECT_URI' });
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw Object.assign(new TypeError('redirectUri must be HTTP or HTTPS'), { code: 'INVALID_REDIRECT_URI' });
    }
    if (allowedRedirectOrigins.length > 0 && !allowedRedirectOrigins.includes(parsed.origin)) {
      throw Object.assign(new Error(`redirectUri origin "${parsed.origin}" is not allowlisted`), {
        code: 'REDIRECT_URI_NOT_ALLOWLISTED'
      });
    }
    return parsed.toString();
  }

  return {
    createAuthorizationRequest({
      connectorId,
      authorizeUrl,
      clientId,
      redirectUri,
      scopes = [],
      agencyId,
      locationId,
      actorId
    }) {
      assertVaultKey();
      const safeRedirect = validateRedirectUri(redirectUri);
      if (!agencyId || !locationId || !actorId) {
        throw Object.assign(new TypeError('Tenant and actor context required'), { code: 'TENANT_CONTEXT_REQUIRED' });
      }
      const codeVerifier = randomBytes(32).toString('base64url');
      const codeChallenge = base64UrlSha256(codeVerifier);
      const nonce = randomBytes(16).toString('hex');
      const payload = {
        connectorId,
        agencyId,
        locationId,
        actorId,
        redirectUri: safeRedirect,
        scopes,
        nonce,
        expiresAt: now() + STATE_TTL_MS
      };
      const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      const sig = createHmac('sha256', stateKey).update(encoded).digest('hex');
      const state = `${encoded}.${sig}`;
      const stateHash = sha256Hex(state);

      pendingStates.set(stateHash, {
        ...payload,
        codeVerifier,
        consumed: false
      });

      const authUrl = new URL(authorizeUrl);
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', safeRedirect);
      authUrl.searchParams.set('scope', scopes.join(' '));
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');

      return { authorizationUrl: authUrl.toString(), state, stateHash };
    },

    verifyAndConsumeState({ state, agencyId, locationId, redirectUri }) {
      assertVaultKey();
      if (typeof state !== 'string' || !state.includes('.')) {
        throw Object.assign(new Error('Malformed OAuth state'), { code: 'OAUTH_STATE_INVALID' });
      }
      const [encoded, sig] = state.split('.');
      const expected = createHmac('sha256', stateKey).update(encoded).digest('hex');
      const a = Buffer.from(sig, 'hex');
      const b = Buffer.from(expected, 'hex');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw Object.assign(new Error('Invalid OAuth state signature'), { code: 'OAUTH_STATE_INVALID' });
      }
      const stateHash = sha256Hex(state);
      const stored = pendingStates.get(stateHash);
      if (!stored || stored.consumed) {
        throw Object.assign(new Error('OAuth state missing or already consumed'), { code: 'OAUTH_STATE_REPLAY' });
      }
      if (stored.expiresAt <= now()) {
        pendingStates.delete(stateHash);
        throw Object.assign(new Error('OAuth state expired'), { code: 'OAUTH_STATE_EXPIRED' });
      }
      if (String(stored.agencyId) !== String(agencyId) || String(stored.locationId) !== String(locationId)) {
        throw Object.assign(new Error('OAuth state tenant mismatch'), { code: 'OAUTH_TENANT_MISMATCH' });
      }
      if (redirectUri && stored.redirectUri !== redirectUri) {
        throw Object.assign(new Error('OAuth redirect URI mismatch'), { code: 'OAUTH_REDIRECT_MISMATCH' });
      }
      stored.consumed = true;
      pendingStates.delete(stateHash);
      return stored;
    },

    async refreshTokenBundle({ secretRef, tokenEndpoint, clientId, clientSecret }) {
      if (refreshLocks.has(secretRef)) {
        return refreshLocks.get(secretRef);
      }
      const pending = (async () => {
        const raw = await secretResolver.resolve(secretRef);
        if (!raw) {
          throw Object.assign(new Error('Credential bundle not found'), { code: 'CREDENTIAL_NOT_FOUND' });
        }
        const bundle = JSON.parse(raw);
        if (bundle.revoked) {
          throw Object.assign(new Error('Connection credentials have been revoked'), { code: 'CREDENTIAL_REVOKED' });
        }
        if (bundle.expiresAt && bundle.expiresAt > now() + 60_000) {
          return { rotated: false, expiresAt: bundle.expiresAt, scopes: bundle.scopes || [] };
        }
        const body = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: bundle.refreshToken,
          client_id: clientId,
          client_secret: clientSecret
        });
        const resp = await fetchFn(tokenEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || typeof data.access_token !== 'string') {
          throw Object.assign(new Error('OAuth token refresh failed'), { code: 'OAUTH_REFRESH_FAILED' });
        }
        const nextBundle = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || bundle.refreshToken,
          expiresAt: now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
          scopes: typeof data.scope === 'string' ? data.scope.split(' ') : (bundle.scopes || []),
          revoked: false,
          rotatedAt: new Date(now()).toISOString()
        };
        await secretResolver.store(secretRef, JSON.stringify(nextBundle));
        return { rotated: true, expiresAt: nextBundle.expiresAt, scopes: nextBundle.scopes };
      })();

      refreshLocks.set(secretRef, pending);
      try {
        return await pending;
      } finally {
        refreshLocks.delete(secretRef);
      }
    },

    async revokeConnectionSecret(secretRef) {
      if (!secretRef) return { revoked: true };
      await secretResolver.store(secretRef, JSON.stringify({ revoked: true, revokedAt: new Date(now()).toISOString() }));
      return { revoked: true };
    }
  };
}
