import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 4006;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_STORE = './data/test_auth_regression_store.json';

// Ensure clean test store
try {
  rmSync(path.join(root, 'apps/api', TEST_STORE), { force: true });
} catch {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('Authentication Routing Dispatch & BDF-01 Regression Suite', async (t) => {
  let serverProcess = null;
  let serverExited = false;
  let exitCode = null;

  await t.test('1. Start API Server on isolated test port', async () => {
    serverProcess = spawn('node', ['apps/api/server.mjs'], {
      cwd: root,
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'test',
        DATA_FILE: TEST_STORE
      }
    });

    serverProcess.on('exit', (code) => {
      serverExited = true;
      exitCode = code;
    });

    // Wait for health endpoint
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
    assert.equal(healthy, true, 'API server should be healthy on startup');
  });

  await t.test('2. Unauthenticated GET /api/auth/session returns 401 without crashing server (BDF-01 fix)', async () => {
    assert.equal(serverExited, false, 'Server must be running');
    const res = await fetch(`${BASE_URL}/api/auth/session`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Not authenticated');

    // Confirm server is still alive immediately afterwards
    await sleep(200);
    assert.equal(serverExited, false, 'Server must NOT crash after unauthenticated /api/auth/session');

    const healthCheck = await fetch(`${BASE_URL}/health`);
    assert.equal(healthCheck.status, 200, 'Health check must return 200 immediately after');
  });

  await t.test('3. Unauthenticated GET /api/auth/me returns 401 cleanly', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Not authenticated');
    assert.equal(serverExited, false, 'Server must remain alive');
  });

  await t.test('4. Unknown /api/auth/* endpoint returns 404 without falling through to business auth', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/unknown-endpoint-xyz`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Auth route not found');
    assert.equal(serverExited, false, 'Server must remain alive');
  });

  await t.test('5. Concurrent unauthenticated requests do not trigger header race condition', async () => {
    const promises = Array.from({ length: 15 }, () => fetch(`${BASE_URL}/api/auth/session`));
    const responses = await Promise.all(promises);
    for (const res of responses) {
      assert.equal(res.status, 401);
    }
    await sleep(200);
    assert.equal(serverExited, false, 'Server must survive concurrent unauthenticated hits');
  });

  let sessionCookie = '';
  let csrfToken = '';

  await t.test('6. User signup succeeds and returns session cookies', async () => {
    const email = `beta-test-${Date.now()}@operza-agency.test`;
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Beta Tester',
        email,
        password: 'Password123!',
        agencyName: 'Beta Testing Corp'
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.user?.id);
    assert.equal(body.user.email, email);

    // Extract all cookies
    const cookieHeaders = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    const cookieParts = [];
    for (const c of cookieHeaders) {
      const firstPart = c.split(';')[0];
      if (firstPart) cookieParts.push(firstPart.trim());
      const csrfMatch = c.match(/operza_csrf=([^;]+)/);
      if (csrfMatch) csrfToken = decodeURIComponent(csrfMatch[1]);
    }
    sessionCookie = cookieParts.join('; ');
  });

  await t.test('7. Authenticated GET /api/auth/session succeeds with session cookie', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/session`, {
      headers: {
        Cookie: sessionCookie
      }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.user?.email);
    assert.ok(body.agency?.name);
    assert.equal(body.role, 'owner');
  });

  await t.test('8. Duplicate signup returns 409 cleanly without crashing', async () => {
    const duplicateRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Duplicate Tester',
        email: 'beta-test-duplicate@operza-agency.test',
        password: 'Password123!',
        agencyName: 'Beta Corp'
      })
    });
    assert.equal(duplicateRes.status, 201);

    const secondRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Duplicate Tester 2',
        email: 'beta-test-duplicate@operza-agency.test',
        password: 'Password123!',
        agencyName: 'Beta Corp'
      })
    });
    assert.equal(secondRes.status, 409);
    const body = await secondRes.json();
    assert.equal(body.error, 'An account with this email already exists');
    assert.equal(serverExited, false, 'Server must remain alive');
  });

  await t.test('9. Invalid login returns 401 cleanly', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent@test.com',
        password: 'WrongPassword'
      })
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Invalid email or password');
    assert.equal(serverExited, false, 'Server must remain alive');
  });

  await t.test('10. Malformed JSON payload returns 400 or handled error without crashing server', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is broken json ::;; '
    });
    assert.ok(res.status >= 400 && res.status <= 500);
    assert.equal(serverExited, false, 'Server must not crash on malformed JSON');
  });

  await t.test('11. Unauthenticated CRM access returns 401 without headers collision', async () => {
    const res = await fetch(`${BASE_URL}/api/crm/contacts`);
    assert.equal(res.status, 401);
    assert.equal(serverExited, false, 'Server must remain alive');
  });

  await t.test('12. Unknown route behavior: unauthenticated gets 401, authenticated gets 404 without headers error', async () => {
    // Unauthenticated request to non-public route gets 401
    const unauthRes = await fetch(`${BASE_URL}/api/completely-unknown-service-path`);
    assert.equal(unauthRes.status, 401, 'Unauthenticated access to private route must be rejected with 401');

    // Authenticated request to unknown route gets 404
    const authRes = await fetch(`${BASE_URL}/api/completely-unknown-service-path`, {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(authRes.status, 404, 'Authenticated access to unknown route must return 404');
    assert.equal(serverExited, false, 'Server must remain alive');
  });

  await t.test('13. Clean teardown', async () => {
    if (serverProcess && !serverExited) {
      serverProcess.kill('SIGTERM');
      await sleep(500);
    }
    try {
      rmSync(path.join(root, 'apps/api', TEST_STORE), { force: true });
    } catch {}
  });
});
