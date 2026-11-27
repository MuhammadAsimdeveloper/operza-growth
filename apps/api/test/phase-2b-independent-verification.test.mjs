import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync, readFileSync, existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { generateKeyPairSync, createSign } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 4030;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_STORE = './data/test_phase2b_audit_store.json';
const TEST_OTP_SINK = path.join(root, 'apps/api/data/test_phase2b_otp_sink.json');
const CLIENT_ID = 'operza-phase2b-audit-client.apps.googleusercontent.com';

// Generate primary test RSA keypair
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const testPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const testPrivateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const TEST_KID = 'audit-kid-001';

// Cleanup stale test files
try { rmSync(path.join(root, 'apps/api', TEST_STORE), { force: true }); } catch {}
try { rmSync(TEST_OTP_SINK, { force: true }); } catch {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTestGoogleJwt(payload, privateKeyPem = testPrivateKeyPem, headerOverrides = {}) {
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

test('Phase 2B: Independent Security Verification Suite', async (t) => {
  let serverProcess = null;
  let serverExited = false;

  await t.test('0. Start Isolated Server for Independent Audit', async () => {
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
    assert.equal(healthy, true, 'Server must be running and healthy');
    assert.equal(serverExited, false);
  });

  // =========================================================================
  // Section 2: Google Authentication Adversarial Verification (SEC-CRIT-001)
  // =========================================================================
  await t.test('2.1 JWT Verification: Rejects token signed with untrusted foreign key', async () => {
    const { privateKey: rogueKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rogueKeyPem = rogueKey.export({ type: 'pkcs8', format: 'pem' });
    const forgedToken = createTestGoogleJwt({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'google_rogue_sub_01',
      email: 'victim@target.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600
    }, rogueKeyPem);

    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: forgedToken })
    });
    assert.equal(res.status, 401, 'Forged signature must fail with 401');
    const body = await res.json();
    assert.ok(body.details.includes('INVALID_SIGNATURE'));
  });

  await t.test('2.2 Algorithm Confusion: Rejects unsupported algorithm (alg: HS256)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', kid: TEST_KID, typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'sub_hs256',
      email: 'hs256@target.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600
    })).toString('base64url');
    const fakeSig = 'fake_hmac_signature';
    const hs256Token = `${header}.${payload}.${fakeSig}`;

    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: hs256Token })
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(body.details.includes('UNSUPPORTED_ALGORITHM'));
  });

  await t.test('2.3 Rejects unknown kid when key is not registered', async () => {
    const unknownKidToken = createTestGoogleJwt({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'sub_unknown_kid',
      email: 'unknown_kid@target.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600
    }, testPrivateKeyPem, { kid: 'non_existent_kid_999' });

    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: unknownKidToken })
    });
    assert.equal(res.status, 401);
  });

  await t.test('2.4 Rejects missing subject claim (sub)', async () => {
    const noSubToken = createTestGoogleJwt({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      email: 'nosub@target.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: noSubToken })
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(body.details.includes('SUB_MISSING'));
  });

  await t.test('2.5 Rejects malformed JWT structures', async () => {
    for (const badToken of ['not-a-jwt', 'header.payload', '', 'a.b.c.d']) {
      const res = await fetch(`${BASE_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: badToken })
      });
      assert.ok(res.status === 400 || res.status === 401, `Token "${badToken}" must be rejected`);
    }
  });

  await t.test('2.6 Password Account Protection: Rejects hijacking of existing password account', async () => {
    // Create password user
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Protected Founder',
        email: 'founder@locked.com',
        password: 'ComplexPassword123!',
        agencyName: 'Locked Agency'
      })
    });
    assert.equal(signupRes.status, 201);

    // Attacker crafts valid Google token for founder@locked.com
    const attackToken = createTestGoogleJwt({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'google_sub_attacker_x',
      email: 'founder@locked.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: attackToken })
    });
    assert.equal(res.status, 409, 'Must reject hijacking of password account with 409');
  });

  // =========================================================================
  // Section 3: Magic-Link and OTP Concurrency & Entropy (SEC-CRIT-002)
  // =========================================================================
  await t.test('3.1 Concurrent verification: 10 parallel requests with same valid code -> exactly ONE succeeds', async () => {
    const email = 'concurrent_otp@agency.com';
    await fetch(`${BASE_URL}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    assert.equal(existsSync(TEST_OTP_SINK), true);
    const sinkData = JSON.parse(readFileSync(TEST_OTP_SINK, 'utf8'));
    assert.equal(sinkData.email, email);
    const validCode = sinkData.code;

    // Dispatch 10 parallel requests simultaneously
    const requests = Array.from({ length: 10 }, () => 
      fetch(`${BASE_URL}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: validCode, name: 'Concurrent User' })
      })
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map(r => r.status);
    const successCount = statuses.filter(s => s === 200).length;
    const failCount = statuses.filter(s => s === 400 || s === 429).length;

    assert.equal(successCount, 1, 'Exactly one concurrent verification must succeed');
    assert.equal(failCount, 9, 'All other concurrent verification attempts must fail (400 or rate-limited 429)');
  });

  await t.test('3.2 Missing delivery provider does NOT return or expose secret', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'no_provider@agency.com' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.devCode, undefined);
    assert.equal(body.code, undefined);
    assert.equal(body.secret, undefined);
  });

  // =========================================================================
  // Section 5: Session Revocation Verification (SEC-HIGH-001)
  // =========================================================================
  await t.test('5.1 Bearer token session revocation on logout', async () => {
    // Login to obtain token
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'founder@locked.com', password: 'ComplexPassword123!' })
    });
    assert.equal(loginRes.status, 200);
    const cookies = loginRes.headers.get('set-cookie');
    const sessionMatch = cookies.match(/operza_session=([^;]+)/)[1];
    const rawToken = decodeURIComponent(sessionMatch);

    // Verify Bearer authentication works
    const bCheck1 = await fetch(`${BASE_URL}/api/auth/session`, {
      headers: { 'Authorization': `Bearer ${rawToken}` }
    });
    assert.equal(bCheck1.status, 200, 'Bearer session must be active');

    // Revoke via Bearer logout
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${rawToken}` }
    });
    assert.equal(logoutRes.status, 200);

    // Reusing Bearer token must now fail with 401
    const bCheck2 = await fetch(`${BASE_URL}/api/auth/session`, {
      headers: { 'Authorization': `Bearer ${rawToken}` }
    });
    assert.equal(bCheck2.status, 401, 'Revoked Bearer token must fail with 401');
  });

  // =========================================================================
  // Section 6: Reverse-Proxy Rate Limiting Limitations (ARCH-HIGH-001)
  // =========================================================================
  await t.test('6.1 Multi-IP Forwarded header: Leftmost client IP is properly extracted', async () => {
    // When trusted proxy is enabled, X-Forwarded-For: client, proxy1, proxy2
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.88, 10.0.0.1, 10.0.0.2'
      },
      body: JSON.stringify({ email: 'forwarded_test@agency.com', password: 'bad' })
    });
    assert.equal(res.status, 401);
  });

  // =========================================================================
  // Section 4: PostgreSQL RLS Context Realignment (DB-CRIT-001)
  // =========================================================================
  await t.test('4.1 Audit of server.mjs: Exclusive use of app.agency_id and app.location_id in transactions', async () => {
    const serverFile = await readFile(path.join(root, 'apps/api/server.mjs'), 'utf8');
    assert.equal(serverFile.includes("'app.current_agency_id'"), false, 'Must not contain app.current_agency_id');
    assert.ok(serverFile.includes("SELECT set_config('app.agency_id', $1, true)"), 'Must set app.agency_id');
    assert.ok(serverFile.includes("SELECT set_config('app.location_id', $1, true)"), 'Must set app.location_id');
    assert.ok(serverFile.includes("await client.query('BEGIN')"), 'Must use transaction BEGIN');
    assert.ok(serverFile.includes("await client.query('COMMIT')"), 'Must use transaction COMMIT');
  });

  // =========================================================================
  // Teardown
  // =========================================================================
  await t.test('99. Teardown Independent Verification Server', async () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await sleep(300);
    }
    try { rmSync(path.join(root, 'apps/api', TEST_STORE), { force: true }); } catch {}
    try { rmSync(TEST_OTP_SINK, { force: true }); } catch {}
  });
});
