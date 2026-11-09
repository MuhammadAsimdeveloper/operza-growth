# Operza — Sprint 0 Independent Security Verification
## Google Authentication & Token Verifier Audit (GOOGLE_AUTH_VERIFICATION.md)

**Audit Target:** `apps/api/lib/google-auth.mjs` & `apps/api/routes/auth.mjs` (`POST /api/auth/google`)  
**Vulnerability Reference:** `SEC-CRIT-001` (Unauthenticated Google OAuth Account Takeover)  
**Auditor Classification:** **VERIFIED**  

---

## 1. Architectural & Source Code Inspection

### 1.1 Token Verifier Architecture (`apps/api/lib/google-auth.mjs`)
The newly introduced verifier module replaces the dangerous development mock with a production-grade, cryptographic OpenID Connect RS256 token validator.

#### Key Security Controls Verified:
1. **Strict Algorithm Whitelisting:**
   ```javascript
   if (header.alg !== 'RS256') {
     throw new Error(`UNSUPPORTED_ALGORITHM: Expected RS256, received ${header.alg}`);
   }
   ```
   - **Protection:** Prevents algorithm confusion attacks where an attacker submits a token signed with HMAC-SHA256 using Google's public key as an HMAC secret, or submits tokens with `alg: "none"`.
2. **Immutable JWKS Authority:**
   Google public certificates are retrieved exclusively from:
   `https://www.googleapis.com/oauth2/v3/certs`
   - **Protection:** The verifier does **not** parse or follow attacker-controlled JWK Set URLs (such as `jku` or `x5u` headers).
3. **Key ID (`kid`) Requirement:**
   Tokens without a valid `kid` in the header or with an unknown `kid` are immediately rejected before cryptographic verification is attempted.
4. **JWKS In-Memory Caching:**
   Keys are cached in memory for 6 hours (`jwksCache.expiresAt = now + 6 * 3600 * 1000`), reducing latency and protecting against denial-of-service from Google rate limiting.
5. **Claims Verification:**
   - **Expiration (`exp`):** Verified against `Math.floor(Date.now() / 1000)`. Expired tokens throw `TOKEN_EXPIRED`.
   - **Issuer (`iss`):** Whitelisted to `['https://accounts.google.com', 'accounts.google.com']`. All other issuers throw `INVALID_ISSUER`.
   - **Audience (`aud`):** Compared strictly against `expectedClientId` (`process.env.GOOGLE_CLIENT_ID`). Mismatched tokens throw `WRONG_AUDIENCE`.
   - **Email Verification (`email_verified`):** Must be strictly `true` or `'true'`. Unverified emails throw `EMAIL_NOT_VERIFIED`.
   - **Subject (`sub`):** Must be a non-empty string.

---

## 2. Account Linking & Hijacking Defenses (`apps/api/routes/auth.mjs`)

The route handler implements defense-in-depth to protect existing agency and user accounts:

```javascript
// File: apps/api/routes/auth.mjs, Lines 260-275
// Account takeover prevention:
// If account was created with password authentication and has no linked googleId,
// prevent silent automatic account takeover.
if (user.passwordHash && user.provider !== 'google' && (!user.googleId || user.googleId !== verifiedPayload.sub)) {
  sendJson(res, 409, {
    error: 'An account with this email already exists with password authentication. Please log in with password first to link Google Sign-In.'
  });
  return true;
}

if (user.googleId && user.googleId !== verifiedPayload.sub) {
  sendJson(res, 403, { error: 'Google identity mismatch for this account' });
  return true;
}
```

### Security Implications:
1. **Existing Password Account Immunity:** An attacker who manages to obtain a verified Google account matching the email of a target user (e.g., via domain compromise or enterprise email takeover) cannot automatically seize control of an existing password-authenticated Operza account. The endpoint returns HTTP 409 Conflict.
2. **Subject Lock-In:** Once an account is linked to a Google subject (`user.googleId`), subsequent sign-ins must originate from the exact same Google subject ID (`sub`).

---

## 3. Adversarial Verification Test Matrix

All 12 required test scenarios were independently executed and verified:

| Test Scenario | Attack / Input Payload | Expected Behavior | Observed Result | Status |
| :--- | :--- | :--- | :--- | :---: |
| **1. Forged Signature** | Token signed with untrusted private RSA key | HTTP 401 Unauthorized | HTTP 401 (`INVALID_SIGNATURE`) | **VERIFIED** |
| **2. Wrong Audience** | Token with `aud: 'attacker-app.com'` | HTTP 401 Unauthorized | HTTP 401 (`WRONG_AUDIENCE`) | **VERIFIED** |
| **3. Wrong Issuer** | Token with `iss: 'https://evil.com'` | HTTP 401 Unauthorized | HTTP 401 (`INVALID_ISSUER`) | **VERIFIED** |
| **4. Expired Token** | Token with `exp: now - 300` | HTTP 401 Unauthorized | HTTP 401 (`TOKEN_EXPIRED`) | **VERIFIED** |
| **5. Missing Subject** | Token with no `sub` claim | HTTP 401 Unauthorized | HTTP 401 (`SUB_MISSING`) | **VERIFIED** |
| **6. Unverified Email**| Token with `email_verified: false` | HTTP 401 Unauthorized | HTTP 401 (`EMAIL_NOT_VERIFIED`) | **VERIFIED** |
| **7. Unknown Key ID** | Token with `kid: 'non_existent_kid'` | HTTP 401 Unauthorized | HTTP 401 (`UNKNOWN_KEY`) | **VERIFIED** |
| **8. Algorithm Confusion**| Token with `alg: 'HS256'` | HTTP 401 Unauthorized | HTTP 401 (`UNSUPPORTED_ALGORITHM`) | **VERIFIED** |
| **9. Malformed Token** | String `'not-a-jwt'`, empty string | HTTP 400 / 401 | HTTP 400 (`TOKEN_MALFORMED`) | **VERIFIED** |
| **10. Password Hijack** | Valid token targeting existing password account | HTTP 409 Conflict | HTTP 409 (Takeover Blocked) | **VERIFIED** |
| **11. Missing Config** | Server runs with no `GOOGLE_CLIENT_ID` | HTTP 503 Unavailable | HTTP 503 (`CONFIG_MISSING`) | **VERIFIED** |
| **12. Valid Identity** | Valid token signed with trusted test RSA key | HTTP 200 + Session | HTTP 200 (Clean Authenticated Session) | **VERIFIED** |

---

## 4. Residual Risks & Production Deployment Gate

1. **Production Google Client Credentials:**
   The implementation is mathematically sound and cryptographically verified. In staging and production environments, the infrastructure operator must provide valid Google credentials:
   - `GOOGLE_CLIENT_ID`: Real OAuth 2.0 Web Client ID from Google Cloud Console.
   - `GOOGLE_CLIENT_SECRET`: Real OAuth 2.0 Client Secret.
2. **Key Rollover Edge Case:**
   If Google rolls out a new signing key (`kid`) during an active 6-hour cache window, incoming tokens signed with that new key will return `UNKNOWN_KEY` until the cache expires or the process restarts.
   - *Recommendation for Sprint 2:* Implement on-demand JWKS re-fetch if a validly formed token presents an unrecognized `kid` that is absent from the existing cache.
