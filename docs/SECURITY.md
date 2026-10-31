# Operza Security Architecture, Threat Model & Compliance

## 1. Security Architecture Principles

Operza operates on a **Defense-in-Depth, Zero-Trust, Fail-Closed** security paradigm:
1. **Never Trust Frontend Assertions:** All authorization checks, resource quotas, and permissions are enforced authoritatively on the backend.
2. **Fail-Closed Default:** In production (`NODE_ENV=production`), missing database credentials, unauthenticated sockets, unverified webhooks, or unseeded environment secrets abort process boot immediately.
3. **Strict Multi-Tenant Isolation:** Tenant boundary crossing is physically prevented at the database layer (PostgreSQL Row-Level Security), WebSocket layer (agency ID packet filtering), and API routing layer.

---

## 2. Threat Mitigation Matrix

| Vulnerability / Attack Vector | Risk Level | Mitigation & Implementation Detail | Verification Status |
| :--- | :---: | :--- | :---: |
| **Cross-Tenant Data Leakage** | Critical | Enforced `FORCE ROW LEVEL SECURITY` on all tenant tables. Queries execute in explicit transactions setting `app.current_agency_id` (`is_local=true`), reset in `finally` blocks. | **VERIFIED (Test 78, 79)** |
| **Cross-Tenant WebSocket Spoofing** | Critical | Socket handshakes validate SHA-256 session token hashes against `auth_sessions`. Agency ID is derived strictly from validated session, rejecting client query params. Broadcast packets check `client.agencyId === targetAgencyId`. | **VERIFIED (Test 86)** |
| **Webhook Forgery & Replay** | High | HMAC-SHA256 signature verification (Stripe, WhatsApp, Meta) with 300s replay window tolerance. Processed event IDs cached in Redis with 1-hour TTL (`operza:dedupe:<id>`). | **VERIFIED (Test 75, 81-83)** |
| **Path Traversal & Malicious Uploads** | High | Uploads in `/api/media/upload` strictly reject executable extensions (`.exe`, `.sh`, `.php`, `.js`, etc.), enforce 25MB limits, and strip path traversal characters via `path.basename`. | **VERIFIED (Test 88)** |
| **CSRF & Session Hijacking** | High | Cookie sessions set `HttpOnly; SameSite=Strict; Secure` (in production). Mutating HTTP requests require cryptographic `x-operza-csrf` header matching session hash. | **VERIFIED (Test 80)** |
| **Resource Quota Exhaustion** | Medium | Server-side plan engine enforces strict limits on contacts, active workflows, monthly executions, and storage capacity before write operations. | **VERIFIED (Test 87)** |
| **Credential / Token Exposure** | High | Zero hardcoded secrets in source code. Production fails closed on startup if `SESSION_SECRET` or `JWT_SECRET` are default or missing. | **VERIFIED** |

---

## 3. Cryptographic Standards

- **Session Tokens:** 32-byte cryptographically secure random entropy (`randomBytes(32)`), stored as SHA-256 hex hashes in PostgreSQL.
- **Passwords:** Scrypt key derivation function (`scrypt(password, salt, 64)`) with cryptographically generated 16-byte salts.
- **Signatures & Webhooks:** Constant-time comparison (`timingSafeEqual`) to prevent timing side-channel attacks.
