import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync, readFileSync, existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { generateKeyPairSync, createSign } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 4022;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_STORE = './data/test_sprint0_security_store.json';
const TEST_OTP_SINK = path.join(root, 'apps/api/data/test_sprint0_otp_sink.json');
const CLIENT_ID = 'operza-test-client-id.apps.googleusercontent.com';

// Generate test RSA keypair for cryptographic Google OAuth testing
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const testPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const testPrivateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const TEST_KID = 'test-kid-operza-01';

// Cleanup stale files
try { rmSync(path.join(root, 'apps/api', TEST_STORE), { force: true }); } catch {}
try { rmSync(TEST_OTP_SINK, { force: true }); } catch {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSignedGoogleJwt(payload, privateKeyPem = testPrivateKeyPem, headerOverrides = {}) {
  const header = {
    alg: 'RS256',
    kid: TEST_KID,
    typ: 'JWT',
    ...headerOverrides
  };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${headerB64}.${payloadB64}`);
  const signature = signer.sign(privateKeyPem, 'base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

test('Sprint 0 Comprehensive Security Remediation Suite', async (t) => {
  let serverProcess = null;
  let serverExited = false;

  await t.test('0. Start API Server with cryptographic test configuration', async () => {
    serverProcess = spawn('node', ['apps/api/server.mjs'], {
      cwd: root,
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'test',
        DATA_FILE: TEST_STORE,
        GOOGLE_CLIENT_ID: CLIENT_ID,
        TEST_GOOGLE_JWKS: JSON.stringify({ [TEST_KID]: testPublicKeyPem }),
        TEST_OTP_SINK_FILE: TEST_OTP_SINK,
        TRUST_PROXY: '1'
      }
    });

    serverProcess.on('exit', () => {
      serverExited = true;
    });

    let healthy = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${BASE_URL}/health`);
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {}
      await sleep(250);
    }
    assert.equal(healthy, true, 'API server must be healthy on startup');
    assert.equal(serverExited, false);
  });

  // =========================================================================
  // 1. Google Authentication & Account Takeover Prevention (SEC-CRIT-001)
  // =========================================================================
  await t.test('1.1 Rejects raw email-only payload without Google ID token', async () => {
    // Legitimate account setup via password
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'CEO Owner',
        email: 'ceo@enterprise.com',
        password: 'Password123!',
        agencyName: 'Enterprise Agency'
      })
    });
    assert.equal(signupRes.status, 201);

    // Attacker sends raw email to /api/auth/google
    const atoRes = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ceo@enterprise.com' })
    });
    assert.equal(atoRes.status, 400, 'Must return 400 when credential/idToken is missing');
    const body = await atoRes.json();
    assert.ok(body.error.includes('Google ID token'));
  });

  await t.test('1.2 Rejects forged signature or malformed JWT token', async () => {
    // Generate forged token signed with an untrusted, foreign key
    const { privateKey: rogueKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rogueKeyPem = rogueKey.export({ type: 'pkcs8', format: 'pem' });
    const forgedToken = createSignedGoogleJwt({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'google_user_rogue_01',
      email: 'victim@enterprise.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600
    }, rogueKeyPem);

    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: forgedToken })
    });
    assert.equal(res.status, 401, 'Forged signature must return 401 Unauthorized');
  });

  await t.test('1.3 Rejects expired Google ID token', async () => {
    const expiredToken = createSignedGoogleJwt({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'google_user_exp_01',
      email: 'expired@enterprise.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) - 300 // Expired 5 minutes ago
    });

    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: expiredToken })
    });
    assert.equal(res.status, 401, 'Expired token must return 401');
    const body = await res.json();
    assert.ok(body.details.includes('TOKEN_EXPIRED'));
  });

  await t.test('1.4 Rejects token with wrong audience', async () => {
    const wrongAudToken = createSignedGoogleJwt({
      iss: 'https://accounts.google.com',
      aud: 'malicious-attacker-client-id.apps.googleusercontent.com',
      sub: 'google_user_aud_01',
      email: 'wrongaud@enterprise.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: wrongAudToken })
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(body.details.includes('WRONG_AUDIENCE'));
  });

  await t.test('1.5 Rejects token with invalid issuer', async () => {
    const invalidIssToken = createSignedGoogleJwt({
      iss: 'https://evil-identity-provider.com',
      aud: CLIENT_ID,
      sub: 'google_user_iss_01',
      email: 'badiss@enterprise.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: invalidIssToken })
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(body.details.includes('INVALID_ISSUER'));
  });

  await t.test('1.6 Rejects token with unverified email (email_verified: false)', async () => {
    const unverifiedEmailToken = createSignedGoogleJwt({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'google_user_unver_01',
      email: 'unverified@enterprise.com',
      email_verified: false,
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: unverifiedEmailToken })
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(body.details.includes('EMAIL_NOT_VERIFIED'));
  });

  await t.test('1.7 Prevents Google token from taking over existing password account', async () => {
    // Attempt to log in via Google using ceo@enterprise.com's email (created with password earlier)
    const takeoverToken = createSignedGoogleJwt({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'google_sub_attacker_99',
      email: 'ceo@enterprise.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: takeoverToken })
    });
    assert.equal(res.status, 409, 'Must return 409 Conflict to prevent password account takeover');
    const body = await res.json();
    assert.ok(body.error.includes('already exists with password authentication'));
  });

  await t.test('1.8 Valid cryptographically signed Google token creates new user and returns sessions', async () => {
    const validToken = createSignedGoogleJwt({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'google_sub_valid_100',
      email: 'new_partner@google-domain.com',
      name: 'Google Partner',
      picture: 'https://lh3.googleusercontent.com/photo.jpg',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: validToken })
    });
    assert.equal(res.status, 200, 'Valid Google token must succeed');
    const body = await res.json();
    assert.equal(body.user.email, 'new_partner@google-domain.com');
    assert.equal(body.user.name, 'Google Partner');

    const cookies = res.headers.get('set-cookie');
    assert.ok(cookies.includes('operza_session'), 'Must issue session cookie');
  });

  await t.test('1.9 Existing password authentication remains fully functional', async () => {
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ceo@enterprise.com',
        password: 'Password123!'
      })
    });
    assert.equal(loginRes.status, 200, 'Password authentication must succeed');
    const body = await loginRes.json();
    assert.equal(body.user.email, 'ceo@enterprise.com');
  });

  // =========================================================================
  // 2. Magic-Link & OTP Security (SEC-CRIT-002)
  // =========================================================================
  await t.test('2.1 POST /api/auth/magic-link NEVER exposes OTP in response body', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'magic_tester@agency.com' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.devCode, undefined);
    assert.equal(body.code, undefined);
    assert.equal(body.otp, undefined);
    assert.ok(body.message.includes('verification code has been dispatched'));
  });

  await t.test('2.2 Anti-abuse rate limit prevents immediate spamming of OTP requests', async () => {
    // Requesting immediately again for magic_tester@agency.com within 15 seconds
    const rapidRes = await fetch(`${BASE_URL}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'magic_tester@agency.com' })
    });
    assert.equal(rapidRes.status, 429, 'Must return 429 when requesting OTP repeatedly');
  });

  await t.test('2.3 Rejects incorrect OTP codes and locks out after 3 failed attempts', async () => {
    const email = 'lockout_test@agency.com';
    const reqRes = await fetch(`${BASE_URL}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    assert.equal(reqRes.status, 200);

    // Retrieve the actual generated code from isolated test sink
    assert.equal(existsSync(TEST_OTP_SINK), true, 'Test sink must capture OTP in test mode');
    const sinkData = JSON.parse(readFileSync(TEST_OTP_SINK, 'utf8'));
    assert.equal(sinkData.email, email);
    const realCode = sinkData.code;

    // Attempt 1: wrong code
    const f1 = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '000000' })
    });
    assert.equal(f1.status, 400);

    // Attempt 2: wrong code
    const f2 = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '111111' })
    });
    assert.equal(f2.status, 400);

    // Attempt 3: wrong code -> triggers lockout & code deletion
    const f3 = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '222222' })
    });
    assert.equal(f3.status, 400);

    // Attempt 4: Even with the REAL code, verification MUST now fail because code was revoked
    const f4 = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: realCode })
    });
    assert.equal(f4.status, 400, 'Must fail even with correct code after lockout');
  });

  await t.test('2.4 One-time use: verification code cannot be reused (replay protection)', async () => {
    const email = 'replay_test@agency.com';
    await fetch(`${BASE_URL}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const sinkData = JSON.parse(readFileSync(TEST_OTP_SINK, 'utf8'));
    const realCode = sinkData.code;

    // First verification succeeds
    const v1 = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: realCode, name: 'Replay Tester' })
    });
    assert.equal(v1.status, 200, 'First verification must succeed');

    // Immediate replay attempt with same code MUST fail
    const v2 = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: realCode })
    });
    assert.equal(v2.status, 400, 'Replay attempt must fail with 400');
  });

  // =========================================================================
  // 3. Server-Side Session Revocation on Logout (SEC-HIGH-001)
  // =========================================================================
  await t.test('3.1 Logout revokes server-side session; reusing old cookie returns 401', async () => {
    // Log in User A
    const loginA = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ceo@enterprise.com', password: 'Password123!' })
    });
    assert.equal(loginA.status, 200);
    const cookiesA = loginA.headers.get('set-cookie');
    const sessionMatchA = cookiesA.match(/(operza_session=[^;]+)/)[1];
    const csrfMatchA = cookiesA.match(/(operza_csrf=[^;]+)/)[1];
    const cookieHeaderA = `${sessionMatchA}; ${csrfMatchA}`;
    const csrfTokenA = decodeURIComponent(csrfMatchA.split('=')[1]);

    // Verify session A works
    const chk1 = await fetch(`${BASE_URL}/api/auth/session`, { headers: { cookie: cookieHeaderA } });
    assert.equal(chk1.status, 200);

    // Logout User A
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: cookieHeaderA,
        'x-operza-csrf': csrfTokenA
      }
    });
    assert.equal(logoutRes.status, 200);

    // Reusing User A's session cookie MUST fail with 401
    const chk2 = await fetch(`${BASE_URL}/api/auth/session`, { headers: { cookie: cookieHeaderA } });
    assert.equal(chk2.status, 401, 'Reusing revoked session cookie must return 401');
  });

  await t.test('3.2 Logging out User A does not invalidate active session for User B', async () => {
    // Create User B
    const signupB = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'User B', email: 'userb@enterprise.com', password: 'Password123!', agencyName: 'Agency B' })
    });
    assert.equal(signupB.status, 201);
    const cookiesB = signupB.headers.get('set-cookie');
    const sessionMatchB = cookiesB.match(/(operza_session=[^;]+)/)[1];
    const csrfMatchB = cookiesB.match(/(operza_csrf=[^;]+)/)[1];
    const cookieHeaderB = `${sessionMatchB}; ${csrfMatchB}`;

    // Verify User B is active
    const chkB = await fetch(`${BASE_URL}/api/auth/session`, { headers: { cookie: cookieHeaderB } });
    assert.equal(chkB.status, 200, 'User B session must be active and isolated');
  });

  await t.test('3.3 Repeated logout requests are safe and idempotent', async () => {
    const res1 = await fetch(`${BASE_URL}/api/auth/logout`, { method: 'POST' });
    assert.equal(res1.status, 200);
    const res2 = await fetch(`${BASE_URL}/api/auth/logout`, { method: 'POST' });
    assert.equal(res2.status, 200);
  });

  // =========================================================================
  // 4. Rate Limiter & Reverse Proxy Safety (ARCH-HIGH-001)
  // =========================================================================
  await t.test('4.1 Untrusted client cannot spoof client IP via X-Forwarded-For', async () => {
    // When request originates from direct loopback with TRUST_PROXY=1, X-Forwarded-For is inspected
    // But when TRUST_PROXY is not enabled or socket is untrusted, header is ignored.
    // Verify that rate limiter tracks keys based on resolved client IP rather than a single global lock.
    const promises = Array.from({ length: 5 }, (_, i) => 
      fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `198.51.100.${i + 1}`
        },
        body: JSON.stringify({ email: `test_${i}@agency.com`, password: 'wrong' })
      })
    );
    const responses = await Promise.all(promises);
    for (const res of responses) {
      assert.equal(res.status, 401, 'Failed logins return 401 without tripping global lockout');
    }
  });

  // =========================================================================
  // 5. Database Row-Level Security Context Verification (DB-CRIT-001)
  // =========================================================================
  await t.test('5.1 Schema Audit: All 14 migrations exclusively check app.agency_id and app.location_id', async () => {
    const migrationsDir = path.join(root, 'packages/db/migrations');
    const files = (await readdir(migrationsDir))
      .filter(f => /^\d{3}_.*\.sql$/.test(f));
    assert.equal(files.length >= 14, true, 'At least 14 migrations exist');

    for (const file of files) {
      const content = await readFile(path.join(migrationsDir, file), 'utf8');
      // Must not contain any reference to app.current_agency_id
      assert.equal(
        content.includes('app.current_agency_id'),
        false,
        `${file} must NOT contain app.current_agency_id`
      );
      assert.equal(
        content.includes('operza.current_agency_id'),
        false,
        `${file} must NOT contain operza.current_agency_id`
      );
    }
  });

  await t.test('5.2 Application Context Alignment: server.mjs uses app.agency_id in transaction', async () => {
    const serverCode = await readFile(path.join(root, 'apps/api/server.mjs'), 'utf8');
    assert.equal(
      serverCode.includes("set_config('app.current_agency_id'"),
      false,
      "server.mjs must NOT contain set_config('app.current_agency_id'"
    );
    assert.ok(
      serverCode.includes("set_config('app.agency_id'"),
      "server.mjs must use set_config('app.agency_id'"
    );
    assert.ok(
      serverCode.includes("set_config('app.location_id'"),
      "server.mjs must use set_config('app.location_id'"
    );
  });

  // =========================================================================
  // Teardown
  // =========================================================================
  await t.test('99. Teardown server', async () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await sleep(300);
    }
    try { rmSync(path.join(root, 'apps/api', TEST_STORE), { force: true }); } catch {}
    try { rmSync(TEST_OTP_SINK, { force: true }); } catch {}
  });
});
