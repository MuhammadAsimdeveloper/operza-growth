/**
 * ============================================================================
 * Operza Google OAuth2 / OpenID Connect Token Verifier
 * ============================================================================
 * Cryptographic RS256 verification of Google ID tokens.
 * Validates signature, issuer, audience, expiration, and email_verified claim.
 */

import { createVerify, createPublicKey } from 'node:crypto';

// In-memory cache of Google's public JWKS keys
let jwksCache = {
  keys: new Map(),
  expiresAt: 0
};

// Test JWKS registry for isolated test suites
const testKeyRegistry = new Map();

if (process.env.NODE_ENV === 'test' && process.env.TEST_GOOGLE_JWKS) {
  try {
    const parsed = JSON.parse(process.env.TEST_GOOGLE_JWKS);
    for (const [kid, pem] of Object.entries(parsed)) {
      testKeyRegistry.set(kid, pem);
    }
  } catch {}
}

export function registerTestGooglePublicKey(kid, publicKeyPem) {
  testKeyRegistry.set(kid, publicKeyPem);
}

export function clearTestGooglePublicKeys() {
  testKeyRegistry.clear();
}

/**
 * Converts JWK RSA key components (n, e) into PEM format if needed,
 * or formats standard RSA public key.
 */
function jwkToPem(jwk) {
  if (jwk.x5c && jwk.x5c.length > 0) {
    const cert = jwk.x5c[0];
    return `-----BEGIN CERTIFICATE-----\n${cert.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`;
  }
  // Convert standard JWK to KeyObject via Node.js crypto
  try {
    const keyObject = createPublicKey({
      key: {
        kty: jwk.kty,
        n: jwk.n,
        e: jwk.e
      },
      format: 'jwk'
    });
    return keyObject.export({ type: 'spki', format: 'pem' });
  } catch (err) {
    throw new Error(`Failed to convert JWK to PEM: ${err.message}`);
  }
}

/**
 * Fetches Google's published JWKS keys from Google's OpenID Connect certs endpoint.
 */
async function getGooglePublicKeys() {
  const now = Date.now();
  if (jwksCache.keys.size > 0 && now < jwksCache.expiresAt) {
    return jwksCache.keys;
  }

  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) {
      throw new Error(`Google certs endpoint returned HTTP ${response.status}`);
    }
    const data = await response.json();
    const newKeys = new Map();

    if (Array.isArray(data.keys)) {
      for (const key of data.keys) {
        if (key.kid && key.kty === 'RSA') {
          try {
            const pem = jwkToPem(key);
            newKeys.set(key.kid, pem);
          } catch {}
        }
      }
    }

    // Cache for 6 hours
    jwksCache = {
      keys: newKeys,
      expiresAt: now + 6 * 3600 * 1000
    };
    return newKeys;
  } catch (err) {
    if (jwksCache.keys.size > 0) {
      return jwksCache.keys;
    }
    throw new Error(`Failed to fetch Google public certs: ${err.message}`);
  }
}

/**
 * Base64URL decode helper
 */
function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Cryptographically verifies a Google ID token.
 * 
 * @param {string} token - The raw Google ID token (JWT)
 * @param {string} expectedClientId - Configured GOOGLE_CLIENT_ID
 * @returns {Promise<{ sub: string, email: string, name: string, picture: string, emailVerified: boolean }>}
 */
export async function verifyGoogleIdToken(token, expectedClientId) {
  if (!token || typeof token !== 'string') {
    throw new Error('TOKEN_MISSING: Google ID token is required');
  }

  if (!expectedClientId) {
    throw new Error('CONFIG_MISSING: GOOGLE_CLIENT_ID is not configured');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new Error('TOKEN_MALFORMED: Token must be a 3-part JWT');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64));
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch (err) {
    throw new Error('TOKEN_MALFORMED: Failed to decode JWT header or payload');
  }

  if (header.alg !== 'RS256') {
    throw new Error(`UNSUPPORTED_ALGORITHM: Expected RS256, received ${header.alg}`);
  }

  const kid = header.kid;
  if (!kid) {
    throw new Error('TOKEN_MALFORMED: Missing key ID (kid) in header');
  }

  // 1. Validate Expiration
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < nowSec) {
    throw new Error('TOKEN_EXPIRED: Token has expired');
  }

  // 2. Validate Issuer
  const validIssuers = ['https://accounts.google.com', 'accounts.google.com'];
  if (!validIssuers.includes(payload.iss)) {
    throw new Error(`INVALID_ISSUER: Issuer ${payload.iss} is not trusted`);
  }

  // 3. Validate Audience
  if (payload.aud !== expectedClientId) {
    throw new Error(`WRONG_AUDIENCE: Token audience does not match configured client ID`);
  }

  // 4. Validate Email Verified
  const isEmailVerified = payload.email_verified === true || payload.email_verified === 'true';
  if (!isEmailVerified) {
    throw new Error('EMAIL_NOT_VERIFIED: Google email is not verified');
  }

  if (!payload.email || typeof payload.email !== 'string') {
    throw new Error('EMAIL_MISSING: Token does not contain an email claim');
  }

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('SUB_MISSING: Token does not contain a subject (sub) claim');
  }

  // 5. Cryptographic Signature Verification
  let publicKeyPem = testKeyRegistry.get(kid);
  if (!publicKeyPem) {
    const keys = await getGooglePublicKeys();
    publicKeyPem = keys.get(kid);
  }

  if (!publicKeyPem) {
    throw new Error(`UNKNOWN_KEY: No matching public key found for kid "${kid}"`);
  }

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  
  // Signature in base64url
  let sigBase64 = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
  while (sigBase64.length % 4) {
    sigBase64 += '=';
  }
  const signatureBuffer = Buffer.from(sigBase64, 'base64');

  const isValid = verifier.verify(publicKeyPem, signatureBuffer);
  if (!isValid) {
    throw new Error('INVALID_SIGNATURE: Cryptographic signature verification failed');
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase().trim(),
    name: payload.name || payload.email.split('@')[0],
    picture: payload.picture || null,
    emailVerified: true
  };
}
