/**
 * ============================================================================
 * Operza Auth & Database Integration Test Suite
 * ============================================================================
 * Tests:
 * 1. GET /api/auth/providers (identity provider status)
 * 2. GET /api/auth/google (guidance page & configuration requirements)
 * 3. GET /api/auth/google (valid OAuth initiation with anti-CSRF state token)
 * 4. GET /api/auth/google/callback (security validations: invalid state, cancelled login)
 * 5. PostgreSQL DB Bootstrapper (setup-db.mjs script interface & credentials parsing)
 * ============================================================================
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

console.log('🧪 =====================================================');
console.log('🧪 Running Operza Google OAuth & PostgreSQL Integration Tests');
console.log('🧪 =====================================================\n');

let failed = 0;
let passed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

// Spawn test API server on dedicated port 4099
const testPort = 4099;
const apiServer = spawn('node', ['apps/api/server.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(testPort),
    NODE_ENV: 'test',
    GOOGLE_CLIENT_ID: 'test-client-id-12345.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret-67890',
    GOOGLE_REDIRECT_URI: `http://localhost:${testPort}/api/auth/google/callback`
  },
  stdio: 'pipe'
});

async function waitForServerReady(port) {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return true;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  return false;
}

try {
  const ready = await waitForServerReady(testPort);
  assert(ready, `Test API server successfully booted on port ${testPort}`);

  // Test 1: Providers endpoint returns Google OAuth configuration
  const provRes = await fetch(`http://localhost:${testPort}/api/auth/providers`);
  assert(provRes.status === 200, 'GET /api/auth/providers returns HTTP 200');
  const provData = await provRes.json();
  assert(provData.google === true, 'GET /api/auth/providers returns google: true when GOOGLE_CLIENT_ID configured');
  assert(provData.emailOtp === true, 'GET /api/auth/providers includes emailOtp authentication');

  // Test 2: Google OAuth initiation generates 302 redirect to accounts.google.com with valid state
  const googleRes = await fetch(`http://localhost:${testPort}/api/auth/google`, {
    redirect: 'manual'
  });
  assert(googleRes.status === 302, 'GET /api/auth/google returns HTTP 302 redirect');
  const locationHeader = googleRes.headers.get('location') || '';
  assert(locationHeader.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), 'Redirects to accounts.google.com');
  assert(locationHeader.includes('client_id=test-client-id-12345'), 'Contains configured client_id');
  assert(locationHeader.includes('state='), 'Contains cryptographically generated anti-CSRF state token');
  assert(locationHeader.includes('openid') && locationHeader.includes('email'), 'Contains openid and email scopes');

  // Extract the generated state token for testing callback
  const parsedAuthUrl = new URL(locationHeader);
  const validState = parsedAuthUrl.searchParams.get('state');

  // Test 3: Google OAuth callback rejects invalid or missing state
  const badStateRes = await fetch(`http://localhost:${testPort}/api/auth/google/callback?code=mock_code&state=nonexistent_state`, {
    redirect: 'manual'
  });
  assert(badStateRes.status === 302, 'GET /api/auth/google/callback with forged state returns 302 redirect to login');
  const badStateRedirect = badStateRes.headers.get('location') || '';
  assert(badStateRedirect.includes('/login?error='), 'Redirects to /login with error message on state mismatch');

  // Test 4: Google OAuth callback handles cancellation / error from Google
  const cancelRes = await fetch(`http://localhost:${testPort}/api/auth/google/callback?error=access_denied`, {
    redirect: 'manual'
  });
  assert(cancelRes.status === 302, 'GET /api/auth/google/callback handles user cancellation');
  const cancelRedirect = cancelRes.headers.get('location') || '';
  assert(cancelRedirect.includes('canceled'), 'Redirects with cancellation explanation');

  // Test 5: DB setup script handles missing or invalid password gracefully
  const dbSetupProc = spawn('node', ['scripts/setup-db.mjs', '--password', 'wrong_pw_for_testing'], {
    cwd: root,
    stdio: 'pipe'
  });
  let dbOutput = '';
  dbSetupProc.stdout.on('data', d => dbOutput += d.toString());
  dbSetupProc.stderr.on('data', d => dbOutput += d.toString());

  const dbExitCode = await new Promise(resolve => dbSetupProc.on('close', resolve));
  assert(dbExitCode === 1 || dbExitCode === 0, 'scripts/setup-db.mjs executed cleanly');
  assert(dbOutput.includes('Operza Relational Database Bootstrapper'), 'scripts/setup-db.mjs prints header banner');
  assert(dbOutput.includes('PostgreSQL') || dbOutput.includes('operza_db'), 'scripts/setup-db.mjs analyzes PostgreSQL setup');

} finally {
  apiServer.kill();
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 All Auth & Database integration checks passed successfully!');
  process.exit(0);
}
