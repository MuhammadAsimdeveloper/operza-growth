# Operza — Deep Release-Readiness, Security & Production Audit
## Application Security & Vulnerability Assessment (SECURITY_AUDIT.md)

**Audit Target:** Operza API & Web Client Security Subsystems  
**Date:** November 9, 2026  
**Auditor:** Principal Application Security Engineer  
**Classification:** HIGH CONFIDENCE / EVIDENCE-BASED AUDIT  

---

## 1. Threat Model & Security Posture Overview

Operza is a multi-tenant business automation platform operating on a hierarchical tenant model:
- **Agency (Top-level Tenant)**: The marketing agency or firm holding the commercial subscription.
- **Location (Sub-Tenant / Workspace)**: Individual client businesses or branches managed by the agency.
- **Users**: Agency Owners, Admins, Account Managers, Location Staff, and End Clients.

The platform processes sensitive business data, including customer PII (names, emails, phone numbers), financial invoices, calendar booking slots, operational automation workflows, and internal AI Copilot conversation logs.

### Primary Threat Vectors Examined
1. **Unauthenticated Account Takeover (ATO)** via broken authentication logic.
2. **Cross-Tenant Data Leakage** via improper multi-tenant authorization boundaries.
3. **Denial of Service (DoS)** via unauthenticated endpoint exhaustion and rate-limiting flaws.
4. **Injection Attacks**: Cross-Site Scripting (XSS), SQL Injection (SQLi), and CSV/Formula Injection.
5. **Session Hijacking & CSRF** across web sessions and API tokens.

---

## 2. Comprehensive Vulnerability Register & Remediation Status

| Vulnerability ID | Severity | Component | File & Line Reference | Impact | Remediation Status (Sprint 0) |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **SEC-CRIT-001** | **CRITICAL** | Google OAuth Handler | `apps/api/routes/auth.mjs` (L195–290) | Complete unauthenticated ATO via raw email payload | **RESOLVED (VERIFIED VIA TDD)** |
| **SEC-CRIT-002** | **CRITICAL** | Magic Link / OTP Endpoint | `apps/api/routes/auth.mjs` (L300–390) | Complete unauthenticated ATO via OTP code leak in JSON | **RESOLVED (VERIFIED VIA TDD)** |
| **SEC-HIGH-001** | **HIGH** | Session Lifecycle | `apps/api/routes/auth.mjs` (L615–645) | Revocation failure; session tokens remain active on logout | **RESOLVED (VERIFIED VIA TDD)** |
| **SEC-HIGH-002** | **HIGH** | Reverse Proxy Rate Limiting | `apps/api/server.mjs` (L250, L2050) | Global Denial of Service for all users behind proxy IP | **RESOLVED (VERIFIED VIA TDD)** |
| **DB-CRIT-001** | **CRITICAL** | PostgreSQL RLS Context Key | `apps/api/server.mjs` (L703–780) | RLS context key mismatch (`app.current_agency_id`) | **RESOLVED (VERIFIED VIA TDD)** |
| **SEC-MED-001** | **MEDIUM** | CORS & Credential Policy | `apps/api/server.mjs` (L2025–2035) | Permissive origin handling under dev environments | P1 Backlog |
| **SEC-LOW-001** | **LOW** | CSRF Token Lifetime | `apps/api/routes/auth.mjs` (L167) | CSRF token remains static across session lifetime | P1 Backlog |

---

## 3. Deep Technical Analysis of Findings

### 3.1 SEC-CRIT-001: Unauthenticated Account Takeover via Mocked `/api/auth/google`

#### Exact Source Code Evidence
```javascript
// File: apps/api/routes/auth.mjs, Lines 191-230
router.post('/google', async (req, res) => {
  try {
    const { credential, email: mockEmail, name: mockName } = req.body || {};
    
    // In dev/mock mode or if mockEmail provided
    let email = mockEmail;
    let name = mockName || 'Google User';
    
    if (credential) {
      // Decode JWT payload (without signature verification if in mock mode)
      try {
        const parts = credential.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          email = payload.email || email;
          name = payload.name || name;
        }
      } catch (e) {
        // Fallback to provided mockEmail
      }
    }

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Lookup user by email in state
    let user = state.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      // Auto-creates user if not found...
    }

    // ISSUES SESSION COOKIES DIRECTLY TO CALLER!
    const token = generateSessionToken();
    state.sessions[token] = { userId: user.id, createdAt: Date.now() };
    setSessionCookies(res, token, user);
    return res.json({ success: true, user });
```

#### Vulnerability Analysis
- **Root Cause:** The endpoint was designed during early Phase 0 development as an offline mock for Google OAuth. It was never removed or gated strictly behind a development flag. It decodes the JWT without cryptographically validating the Google OAuth signature against Google's published JWKS keys (`https://www.googleapis.com/oauth2/v3/certs`), and worse, accepts a raw `{ "email": "..." }` field.
- **Exploit Scenario:**
  1. Attacker identifies an agency owner email (e.g., `owner@acmeagency.com`).
  2. Attacker sends:
     ```http
     POST /api/auth/google HTTP/1.1
     Host: app.operza.com
     Content-Type: application/json

     {
       "email": "owner@acmeagency.com"
     }
     ```
  3. The server looks up `owner@acmeagency.com`, generates a session token, and responds with `Set-Cookie: operza_session=...; HttpOnly; SameSite=Lax`.
  4. The attacker now possesses full administrative privileges over the agency, its client locations, CRM contacts, and billing.
- **Remediation:**
  1. For production: Remove raw `email` acceptance. Require valid Google ID tokens.
  2. Use Google's official `google-auth-library` or `jose` to verify JWT signature, issuer (`https://accounts.google.com`), and audience (`GOOGLE_CLIENT_ID`).
  3. Gate mock behaviors behind `if (process.env.NODE_ENV === 'test' && process.env.ENABLE_AUTH_MOCKS === 'true')`.

---

### 3.2 SEC-CRIT-002: Unauthenticated Account Takeover via OTP Code Leak in `/api/auth/magic-link`

#### Exact Source Code Evidence
```javascript
// File: apps/api/routes/auth.mjs, Lines 306-318
router.post('/magic-link', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  // Generate 6-digit OTP code using unseeded Math.random()
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

  state.otpCodes[email.toLowerCase()] = { code, expiresAt };

  // LEAK: Code is returned in HTTP response body!
  return res.json({ 
    success: true, 
    message: 'Verification code sent',
    devCode: code // <-- CRITICAL VULNERABILITY
  });
});
```

#### Vulnerability Analysis
- **Root Cause:** Developer convenience stub returning the generated OTP in `devCode`. Furthermore, `Math.random()` is not cryptographically secure and is susceptible to PRNG state recovery.
- **Exploit Scenario:**
  1. Attacker POSTs to `/api/auth/magic-link` with `{"email": "admin@target.com"}`.
  2. Server responds: `{"success": true, "message": "Verification code sent", "devCode": "749214"}`.
  3. Attacker immediately posts `{"email": "admin@target.com", "code": "749214"}` to `/api/auth/verify-otp`.
  4. Attacker receives authenticated session cookies for `admin@target.com`.
- **Remediation:**
  1. Never return `devCode` in the HTTP response under any circumstances in staging or production.
  2. Use `crypto.randomInt(100000, 1000000)` instead of `Math.random()`.
  3. Connect an actual transactional email provider (SendGrid, AWS SES, or Resend) to deliver the OTP out-of-band.
  4. Implement an attempt-limiting counter on `/api/auth/verify-otp` (maximum 3 failed attempts before code invalidation).

---

### 3.3 SEC-HIGH-001: Incomplete Session Invalidation on Logout

#### Exact Source Code Evidence
```javascript
// File: apps/api/routes/auth.mjs, Lines 535-539
router.post('/logout', (req, res) => {
  clearSessionCookies(res);
  return res.json({ success: true, message: 'Logged out successfully' });
});
```

#### Vulnerability Analysis
- **Root Cause:** `clearSessionCookies(res)` instructs the user's browser to delete the cookie by setting an expired cookie header (`Max-Age=0`). However, the server never touches `state.sessions`!
- **Impact:** The session token remains completely valid in server memory until the 12-hour expiration window lapses. If an attacker stole or captured the cookie before the user clicked "Logout", the attacker can continue making authenticated requests for hours after the legitimate user believed they had logged out.
- **Remediation:**
  Extract the session token from `req.cookies.operza_session`, delete `state.sessions[token]`, and purge from Redis / PostgreSQL session cache:
  ```javascript
  const token = req.cookies?.operza_session;
  if (token && state.sessions[token]) {
    delete state.sessions[token];
  }
  clearSessionCookies(res);
  ```

---

### 3.4 SEC-HIGH-002 / ARCH-HIGH-001: Rate Limiter Blindness & Global Denial of Service

#### Exact Source Code Evidence
```javascript
// File: apps/api/server.mjs, Lines 2014, 2030-2035
const getClientIp = (req) => {
  return req.socket.remoteAddress || '127.0.0.1';
};

// Inside rate limiting middleware:
const clientIp = getClientIp(req);
const key = `${clientIp}:${req.path}`;
// Sliding window limit: 10 requests per 60 seconds on auth endpoints
if (count > limit) {
  return res.status(429).json({ error: 'Too many requests' });
}
```

#### Vulnerability Analysis
- **Root Cause:** When running in a standard production cloud deployment (behind AWS Application Load Balancer, Cloudflare, or an Nginx ingress controller), `req.socket.remoteAddress` returns the IP address of the reverse proxy or pod network gateway (e.g., `10.0.1.15`), NOT the actual client's IP.
- **Impact:**
  1. **Global Denial of Service:** When an automated bot or misbehaving client triggers 10 auth requests within 60 seconds, the rate limit key `10.0.1.15:/api/auth/login` trips. The server then blocks ALL login attempts from ALL customers worldwide for the duration of the window.
  2. **Rate Limit Bypass:** Conversely, if an attacker uses multiple proxies to target endpoints keyed by header, or if an attacker spoofs unvalidated headers, limits can be bypassed.
- **Remediation:**
  1. Configure Express: `app.set('trust proxy', true)`.
  2. Extract client IP safely from `req.ip` or the leftmost un-spoofed IP in `X-Forwarded-For` using a configured proxy subnet whitelist.
  3. Key authentication rate limiting by compound keys: `${clientIp}:${req.body.email || 'anon'}`.

---

## 4. Evaluated Positive Security Controls

While the audit uncovered critical authentication logic gaps, several modern security defenses are correctly implemented in the codebase:

### 1. CSV Formula Injection Defense (Sanitization)
In `apps/api/routes/crm.mjs`, CSV export routines properly sanitize untrusted string cells:
```javascript
export function sanitizeCsvField(val) {
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  // Neutralize formula triggers: =, +, -, @, tab, carriage return
  if (/^[=\+\-@\t\r]/.test(trimmed)) {
    return `'${trimmed}`;
  }
  return trimmed;
}
```
This prevents malicious payloads such as `=cmd|' /C calc'!A0` or `=HYPERLINK(...)` from executing when an agency user exports contacts into Microsoft Excel or Google Sheets.

### 2. Cookie Hardening & CSRF Tokens
- **Cookie Security:** The session cookie `operza_session` is issued with `HttpOnly: true` (preventing JavaScript access via XSS) and `SameSite: 'Lax'` (mitigating cross-origin request forgery).
- **CSRF Token:** An anti-CSRF token (`operza_csrf`) is verified on all state-mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) via the `x-csrf-token` header.

### 3. Password Hashing
In `apps/api/routes/auth.mjs`, passwords are hashed using Node's native `crypto.scrypt` with a cryptographically secure per-user 16-byte salt, 64-byte key length, and constant-time `crypto.timingSafeEqual` comparison, protecting against timing attacks and rainbow-table lookups.

### 4. SQL Injection Protection
All database queries in `packages/db` use parameterized SQL statements (`$1, $2, ...`) through PostgreSQL client connection pools (`pg.Pool`), eliminating standard string-concatenation SQL injection vulnerabilities.

---

## 5. Security Action Plan & Remediation Status

- [x] **SEC-P0-1**: Disable raw email login in `/api/auth/google`. Enforce cryptographic Google ID token verification via RS256. (RESOLVED in Sprint 0)
- [x] **SEC-P0-2**: Strip `devCode` from `/api/auth/magic-link`. Implement secure random integer + salted hash OTP with 3-attempt lockout. (RESOLVED in Sprint 0)
- [x] **SEC-P0-3**: Fix `/api/auth/logout` to explicitly purge session records from server memory and database. (RESOLVED in Sprint 0)
- [x] **SEC-P0-4**: Implement proxy-aware IP extraction (`resolveClientIp`) and scope authentication rate limiting. (RESOLVED in Sprint 0)
- [x] **DB-P0-1**: Align PostgreSQL RLS context to `app.agency_id` and `app.location_id` inside explicit transactions. (RESOLVED in Sprint 0)
- [ ] **SEC-P1-1**: Add Redis-backed sliding window rate limiter to replace in-memory Map for distributed multi-instance deployment.
- [ ] **SEC-P1-2**: Implement per-session CSRF token rotation on sensitive administrative actions.
- [ ] **SEC-P2-1**: Integrate AWS Secrets Manager / Vault for runtime secret injection instead of static `.env`.
