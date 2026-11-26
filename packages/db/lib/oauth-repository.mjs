/**
 * Phase 7 — OAuth 2.0 Application Platform Repository (TenantTx)
 * Implements confidential client registration, hashed secret/token storage,
 * exact redirect URI matching, PKCE S256 verification, single-use auth codes,
 * refresh token rotation, and token-family revocation on reuse.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function safeHashEqual(aHex, bHex) {
  const a = Buffer.from(String(aHex || ''), 'utf8');
  const b = Buffer.from(String(bHex || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createOAuthRepository() {
  return {
    async createApp(tx, {
      id = randomUUID(),
      name,
      redirectUris = [],
      allowedScopes = ['contacts:read'],
      createdBy
    } = {}) {
      if (!name || !Array.isArray(redirectUris) || redirectUris.length === 0) {
        throw Object.assign(new TypeError('App name and at least one redirect URI are required'), {
          code: 'INVALID_OAUTH_APP'
        });
      }
      for (const uri of redirectUris) {
        const parsed = new URL(uri);
        if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
          throw Object.assign(new TypeError(`Redirect URI must use HTTPS: ${uri}`), { code: 'INSECURE_REDIRECT_URI' });
        }
      }

      const clientId = `opz_app_${randomBytes(12).toString('hex')}`;
      const clientSecret = `opz_sec_${randomBytes(24).toString('hex')}`;
      const secretHash = sha256Hex(clientSecret);
      const secretPrefix = clientSecret.slice(0, 12);

      const res = await tx.query(
        `INSERT INTO oauth_apps (
          agency_id, location_id, id, name, client_id, client_secret_hash,
          client_secret_prefix, redirect_uris, allowed_scopes, status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 'active', $10)
        RETURNING id, agency_id, location_id, name, client_id, client_secret_prefix, redirect_uris, allowed_scopes, status, created_at`,
        [
          tx.agencyId,
          tx.locationId,
          id,
          name.trim(),
          clientId,
          secretHash,
          secretPrefix,
          JSON.stringify(redirectUris),
          JSON.stringify(allowedScopes),
          createdBy || 'system'
        ]
      );

      // Plaintext secret returned ONLY at creation
      return { app: res.rows[0], clientSecret };
    },

    async issueAuthorizationCode(tx, {
      clientId,
      userId,
      redirectUri,
      scopes = [],
      codeChallenge = null,
      codeChallengeMethod = 'S256',
      ttlSeconds = 300
    } = {}) {
      const appRes = await tx.query(
        `SELECT * FROM oauth_apps WHERE agency_id = $1 AND location_id = $2 AND client_id = $3 AND status = 'active'`,
        [tx.agencyId, tx.locationId, clientId]
      );
      const app = appRes.rows[0];
      if (!app) {
        throw Object.assign(new Error('OAuth application not found or inactive'), { code: 'OAUTH_APP_INVALID' });
      }

      const registeredUris = Array.isArray(app.redirect_uris) ? app.redirect_uris : [];
      if (!registeredUris.includes(redirectUri)) {
        throw Object.assign(new Error('Redirect URI does not match registered URI'), { code: 'REDIRECT_URI_MISMATCH' });
      }

      const allowed = Array.isArray(app.allowed_scopes) ? app.allowed_scopes : [];
      const invalidScopes = scopes.filter((s) => !allowed.includes(s));
      if (invalidScopes.length > 0) {
        throw Object.assign(new Error(`Disallowed scopes requested: ${invalidScopes.join(', ')}`), {
          code: 'INVALID_SCOPE'
        });
      }

      const code = `opz_code_${randomBytes(24).toString('hex')}`;
      const expiresAt = new Date(Date.now() + Math.min(600, Math.max(30, ttlSeconds)) * 1000);

      await tx.query(
        `INSERT INTO oauth_auth_codes (
          agency_id, location_id, id, app_id, user_id, code_hash, redirect_uri,
          scopes, code_challenge, code_challenge_method, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
        [
          tx.agencyId,
          tx.locationId,
          randomUUID(),
          app.id,
          userId,
          sha256Hex(code),
          redirectUri,
          JSON.stringify(scopes),
          codeChallenge,
          codeChallenge ? codeChallengeMethod : null,
          expiresAt
        ]
      );
      return { code, expiresAt: expiresAt.toISOString() };
    },

    async exchangeAuthorizationCode(tx, {
      clientId,
      clientSecret,
      code,
      redirectUri,
      codeVerifier = null,
      now = Date.now()
    } = {}) {
      const appRes = await tx.query(
        `SELECT * FROM oauth_apps WHERE agency_id = $1 AND location_id = $2 AND client_id = $3 AND status = 'active'`,
        [tx.agencyId, tx.locationId, clientId]
      );
      const app = appRes.rows[0];
      if (!app || !safeHashEqual(app.client_secret_hash, sha256Hex(clientSecret))) {
        throw Object.assign(new Error('Invalid OAuth client credentials'), { code: 'INVALID_CLIENT' });
      }

      const codeRes = await tx.query(
        `SELECT * FROM oauth_auth_codes
         WHERE agency_id = $1 AND location_id = $2 AND app_id = $3 AND code_hash = $4`,
        [tx.agencyId, tx.locationId, app.id, sha256Hex(code)]
      );
      const authCode = codeRes.rows[0];
      if (!authCode) {
        throw Object.assign(new Error('Authorization code not found'), { code: 'INVALID_GRANT' });
      }
      if (authCode.consumed_at) {
        throw Object.assign(new Error('Authorization code already used (replay blocked)'), { code: 'AUTH_CODE_REPLAYED' });
      }
      if (new Date(authCode.expires_at).getTime() < now) {
        throw Object.assign(new Error('Authorization code expired'), { code: 'AUTH_CODE_EXPIRED' });
      }
      if (authCode.redirect_uri !== redirectUri) {
        throw Object.assign(new Error('Redirect URI mismatch'), { code: 'REDIRECT_URI_MISMATCH' });
      }
      if (authCode.code_challenge) {
        const expectedChallenge = createHash('sha256').update(String(codeVerifier || '')).digest('base64url');
        if (!codeVerifier || expectedChallenge !== authCode.code_challenge) {
          throw Object.assign(new Error('PKCE code_verifier mismatch'), { code: 'PKCE_FAILED' });
        }
      }

      await tx.query(
        `UPDATE oauth_auth_codes SET consumed_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [tx.agencyId, tx.locationId, authCode.id]
      );

      const accessToken = `opz_at_${randomBytes(24).toString('hex')}`;
      const refreshToken = `opz_rt_${randomBytes(24).toString('hex')}`;
      const tokenId = randomUUID();
      const expiresAt = new Date(now + 3600_000);
      const refreshExpiresAt = new Date(now + 30 * 86400_000);

      await tx.query(
        `INSERT INTO oauth_tokens (
          agency_id, location_id, id, app_id, user_id, access_token_hash,
          refresh_token_hash, scopes, expires_at, refresh_expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
        [
          tx.agencyId,
          tx.locationId,
          tokenId,
          app.id,
          authCode.user_id,
          sha256Hex(accessToken),
          sha256Hex(refreshToken),
          JSON.stringify(authCode.scopes || []),
          expiresAt,
          refreshExpiresAt
        ]
      );

      return {
        tokenType: 'Bearer',
        accessToken,
        refreshToken,
        expiresIn: 3600,
        scopes: authCode.scopes || []
      };
    },

    async rotateRefreshToken(tx, { clientId, clientSecret, refreshToken, now = Date.now() } = {}) {
      const appRes = await tx.query(
        `SELECT * FROM oauth_apps WHERE agency_id = $1 AND location_id = $2 AND client_id = $3 AND status = 'active'`,
        [tx.agencyId, tx.locationId, clientId]
      );
      const app = appRes.rows[0];
      if (!app || !safeHashEqual(app.client_secret_hash, sha256Hex(clientSecret))) {
        throw Object.assign(new Error('Invalid OAuth client credentials'), { code: 'INVALID_CLIENT' });
      }

      const tokRes = await tx.query(
        `SELECT * FROM oauth_tokens WHERE agency_id = $1 AND location_id = $2 AND app_id = $3 AND refresh_token_hash = $4`,
        [tx.agencyId, tx.locationId, app.id, sha256Hex(refreshToken)]
      );
      const existing = tokRes.rows[0];
      if (!existing) {
        throw Object.assign(new Error('Invalid refresh token'), { code: 'INVALID_GRANT' });
      }

      // Refresh-token reuse detection -> revoke entire family for app+user
      if (existing.revoked_at || existing.replaced_by_id) {
        await tx.query(
          `UPDATE oauth_tokens SET revoked_at = now()
           WHERE agency_id = $1 AND location_id = $2 AND app_id = $3 AND user_id = $4 AND revoked_at IS NULL`,
          [tx.agencyId, tx.locationId, app.id, existing.user_id]
        );
        throw Object.assign(new Error('Refresh token reuse detected; token family revoked'), {
          code: 'REFRESH_TOKEN_REUSED'
        });
      }

      if (new Date(existing.refresh_expires_at).getTime() < now) {
        throw Object.assign(new Error('Refresh token expired'), { code: 'REFRESH_TOKEN_EXPIRED' });
      }

      const newTokenId = randomUUID();
      const newAccessToken = `opz_at_${randomBytes(24).toString('hex')}`;
      const newRefreshToken = `opz_rt_${randomBytes(24).toString('hex')}`;

      await tx.query(
        `UPDATE oauth_tokens SET revoked_at = now(), replaced_by_id = $4
         WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [tx.agencyId, tx.locationId, existing.id, newTokenId]
      );

      await tx.query(
        `INSERT INTO oauth_tokens (
          agency_id, location_id, id, app_id, user_id, access_token_hash,
          refresh_token_hash, scopes, expires_at, refresh_expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
        [
          tx.agencyId,
          tx.locationId,
          newTokenId,
          app.id,
          existing.user_id,
          sha256Hex(newAccessToken),
          sha256Hex(newRefreshToken),
          JSON.stringify(existing.scopes || []),
          new Date(now + 3600_000),
          new Date(now + 30 * 86400_000)
        ]
      );

      return {
        tokenType: 'Bearer',
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 3600,
        scopes: existing.scopes || []
      };
    }
  };
}
