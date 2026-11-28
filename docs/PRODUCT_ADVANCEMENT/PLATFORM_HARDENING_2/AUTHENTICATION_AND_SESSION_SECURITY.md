# Authentication and Session Security — Stage 18

## 1. Audited Flows (`apps/api/routes/auth.mjs` & `apps/api/server.mjs`)

- **Password Hashing:** `scrypt` with 16-byte random salt (`randomBytes(16)`) and 64-byte derived key, compared using `timingSafeEqual` (`safeEqual`).
- **Session Tokens & CSRF:** 32-byte `randomBytes` session token + 24-byte `randomBytes` CSRF token; only SHA-256 hashes (`token_hash`, `csrf_hash`) are stored in `auth_sessions` and `state.sessions`.
- **OTP Verification (`/api/auth/verify-otp`):** Salted SHA-256 hash comparison via `safeEqual`, bounded attempt lockout (`record.attempts >= record.maxAttempts`), expiry check, and immediate deletion on use (single-use replay prevention).
- **Session Resolution (`getActor`):** Uses `SECURITY DEFINER` `resolve_auth_session($1)` in PostgreSQL, verifies `user_status === 'active'` and `agency_status === 'active'`, verifies active `agency_memberships`, and enforces `user_location_memberships`.
- **Logout & Offboarding:** `POST /api/auth/logout` deletes from `auth_sessions` by `token_hash` and clears session cookies. Stage 17 offboarding revokes all `auth_sessions` for `(agency_id, user_id)`.
- **Rate Limiting:** `createAuthRateLimiter` enforces IP + hashed-identifier sliding-window limits on `login`, `otp_request`, `otp_verify`, `password_reset`, `oauth_authorize`, and `oauth_token`.

## 2. Honest Limitations

- **MFA (TOTP/WebAuthn):** Not implemented in the current authentication schema; do not claim TOTP/WebAuthn MFA support.
- **Distributed Rate Limiting:** Uses in-memory sliding windows locally unless Redis is configured with `DISTRIBUTED_RATE_LIMIT_STRICT=true`.
- **Transactional Email Delivery:** Password reset / magic link / invitation emails are not dispatched to a live SMTP/SES/Resend provider in local mode.
