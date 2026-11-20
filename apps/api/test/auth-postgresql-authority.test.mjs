import test from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatedTestPostgres } from '../../../packages/db/lib/test-postgres-server.mjs';

const scrypt = promisify(crypto.scrypt);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const API_PORT = 4012;
const BASE_URL = `http://127.0.0.1:${API_PORT}`;
const TEST_STORE = './data/test_auth_authority_store.json';

try {
  rmSync(path.join(root, 'apps/api', TEST_STORE), { force: true });
} catch {}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const passBuf = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${passBuf.toString('hex')}`;
}

async function seedUserFixture(pool, {
  userId = randomUUID(),
  email = 'test@example.com',
  password = 'Password123!',
  userStatus = 'active',
  agencyId = randomUUID(),
  agencyName = 'Test Agency',
  agencyStatus = 'active',
  membershipRole = 'owner',
  membershipStatus = 'active',
  includeMembership = true,
  locationId = randomUUID(),
  locationName = 'Main HQ',
  locationStatus = 'active',
  includeLocation = true
} = {}) {
  const passwordHash = await hashPassword(password);
  await pool.query(
    'INSERT INTO users (id, name, email, password_hash, status) VALUES ($1, $2, $3, $4, $5)',
    [userId, 'Test User', email.toLowerCase().trim(), passwordHash, userStatus]
  );
  await pool.query(
    'INSERT INTO agencies (id, name, slug, status) VALUES ($1, $2, $3, $4)',
    [agencyId, agencyName, email.split('@')[0], agencyStatus]
  );
  if (includeLocation) {
    await pool.query(
      'INSERT INTO locations (id, agency_id, name, status) VALUES ($1, $2, $3, $4)',
      [locationId, agencyId, locationName, locationStatus]
    );
  }
  if (includeMembership) {
    await pool.query(
      'INSERT INTO agency_memberships (id, agency_id, user_id, role, status) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), agencyId, userId, membershipRole, membershipStatus]
    );
  }
  return { userId, agencyId, locationId, email, password };
}

test('PostgreSQL-Authoritative Authentication & Session Resolution Regression Suite', async (t) => {
  const pgServer = new IsolatedTestPostgres({ port: 5439, dbName: 'operza_auth_authority_test' });
  const dbUrl = await pgServer.start();

  const { default: pg } = await import('pg');
  const superuserPool = new pg.Pool({ connectionString: dbUrl, max: 10 });

  let serverProcess = null;

  const startServer = async () => {
    try {
      rmSync(path.join(root, 'apps/api', TEST_STORE), { force: true });
    } catch {}

    const appDbUrl = dbUrl.replace('//postgres@', '//operza_app:operza_app_secret@').replace('//postgres:', '//operza_app:operza_app_secret@');
    const appEnv = {
      ...process.env,
      PORT: String(API_PORT),
      NODE_ENV: 'test',
      PLATFORM_DB_ENABLED: 'true',
      DATABASE_URL: appDbUrl,
      MIGRATION_DATABASE_URL: dbUrl,
      OPERZA_TEST_DATABASE_URL: appDbUrl,
      DATA_FILE: TEST_STORE,
      SESSION_SECRET: 'test-session-secret-for-staging-auth-at-least-32-chars',
      OPERZA_VAULT_KEY: 'test-vault-key-for-approvals-32-chars-long',
      OPERZA_ADMIN_KEY: 'operza-admin-telemetry-secret-key-32chars-valid-pass'
    };

    serverProcess = spawn('node', ['apps/api/server.mjs'], {
      cwd: root,
      stdio: 'pipe',
      env: appEnv
    });

    let serverLogs = '';
    serverProcess.stdout.on('data', d => { serverLogs += d.toString(); });
    serverProcess.stderr.on('data', d => { serverLogs += d.toString(); });

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
    if (!healthy) {
      console.error('SERVER LOGS ON STARTUP FAILURE:\n', serverLogs);
    }
    assert.equal(healthy, true, 'API server should be healthy on startup');
  };

  const stopServer = async () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await sleep(300);
      try {
        serverProcess.kill('SIGKILL');
      } catch {}
      serverProcess = null;
    }
  };

  t.after(async () => {
    await stopServer();
    await superuserPool.end();
    await pgServer.stop();
  });

  // Step 1: Run all migrations sequentially
  await t.test('Setup: Run all database migrations (001-027)', async () => {
    await superuserPool.query(`
      CREATE EXTENSION IF NOT EXISTS btree_gist;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_auth_definer') THEN
          CREATE ROLE operza_auth_definer NOLOGIN NOINHERIT BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_migrator') THEN
          CREATE ROLE operza_migrator LOGIN PASSWORD 'operza_migrator_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_app') THEN
          CREATE ROLE operza_app LOGIN PASSWORD 'operza_app_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_worker') THEN
          CREATE ROLE operza_worker LOGIN PASSWORD 'operza_worker_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
      END $$;
      GRANT ALL ON SCHEMA public TO operza_migrator;
      GRANT USAGE, CREATE ON SCHEMA public TO operza_auth_definer;
      GRANT operza_auth_definer TO operza_migrator;
      GRANT USAGE ON SCHEMA public TO operza_app, operza_worker;

      CREATE OR REPLACE FUNCTION trg_fix_migrator_templates()
      RETURNS event_trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      DECLARE
        cmd record;
      BEGIN
        FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
        LOOP
          IF cmd.object_type = 'policy' AND cmd.object_identity LIKE '%workflow_templates%' THEN
            IF NOT EXISTS (
              SELECT 1 FROM pg_policies WHERE tablename = 'workflow_templates' AND policyname = 'workflow_templates_migrator_policy'
            ) THEN
              EXECUTE 'CREATE POLICY workflow_templates_migrator_policy ON workflow_templates FOR ALL TO operza_migrator USING (true) WITH CHECK (true)';
            END IF;
          END IF;
        END LOOP;
      END;
      $$;

      DROP EVENT TRIGGER IF EXISTS trg_migrator_templates_rls;
      CREATE EVENT TRIGGER trg_migrator_templates_rls ON ddl_command_end
      EXECUTE FUNCTION trg_fix_migrator_templates();
    `);

    const files = (await readdir(migrationsDir))
      .filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
      .sort();

    assert.ok(files.length >= 27, `Expected 27 migrations, found ${files.length}`);

    await superuserPool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now());');

    for (const file of files) {
      const client = await superuserPool.connect();
      try {
        await client.query('BEGIN');
        const sql = await readFile(path.join(migrationsDir, file), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING;', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file} failed: ${err.message}`);
      } finally {
        client.release();
      }
    }

    // Provision operza_app_state and worker_heartbeats for API server runtime
    await superuserPool.query(`
      CREATE TABLE IF NOT EXISTS operza_app_state (
        id text PRIMARY KEY,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS worker_heartbeats (
        worker_id text PRIMARY KEY,
        hostname text,
        pid integer,
        last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
        status text NOT NULL DEFAULT 'alive' CHECK (status IN ('alive', 'stopped', 'degraded')),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      GRANT ALL ON TABLE operza_app_state, worker_heartbeats TO operza_app, operza_worker;
    `);
  });

  // Step 2: Start API Server with staging/prod DB authority
  await t.test('Setup: Start API Server on port 4012', async () => {
    await startServer();
  });

  // Scenario 1: Cold login with empty in-memory state
  const coldUserEmail = 'cold-user@example.com';
  const coldUserPassword = 'ColdPassword123!';
  let coldUserFixture = null;

  await t.test('Scenario 1: Cold login with user existing solely in PostgreSQL', async () => {
    coldUserFixture = await seedUserFixture(superuserPool, {
      email: coldUserEmail,
      password: coldUserPassword,
      agencyName: 'Cold Agency'
    });

    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: coldUserEmail, password: coldUserPassword })
    });

    assert.equal(res.status, 200, 'Cold login must succeed with 200');
    const body = await res.json();
    assert.equal(body.user.email, coldUserEmail);
    assert.equal(body.agency.id, coldUserFixture.agencyId);
    assert.ok(body.locations.length > 0);
  });

  // Scenario 2: Valid user login sets cookies and returns valid session
  let scenario2Cookies = '';
  await t.test('Scenario 2: Valid login returns 200, sets cookies, and issues valid CSRF', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: coldUserEmail, password: coldUserPassword })
    });

    assert.equal(res.status, 200);
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    scenario2Cookies = cookies.map(c => c.split(';')[0]).join('; ');

    assert.ok(scenario2Cookies.includes('operza_session='), 'Must set session cookie');
    assert.ok(scenario2Cookies.includes('operza_csrf='), 'Must set CSRF cookie');
  });

  // Scenario 3: Incorrect password returns 401 Unauthorized
  await t.test('Scenario 3: Incorrect password returns 401 Unauthorized', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: coldUserEmail, password: 'WrongPassword999!' })
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Invalid email or password');
  });

  // Scenario 4: User not in DB returns 401 Unauthorized
  await t.test('Scenario 4: User not in PostgreSQL returns 401 Unauthorized', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ghost-user@example.com', password: 'Password123!' })
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Invalid email or password');
  });

  // Scenario 5: PostgreSQL throws -> returns 500 DATABASE_AUTH_LOOKUP_FAILED in staging/production mode
  await t.test('Scenario 5: PostgreSQL lookup error returns 500 DATABASE_AUTH_LOOKUP_FAILED', async () => {
    // Drop function temporarily to cause a DB throw
    await superuserPool.query('DROP FUNCTION lookup_user_for_auth(text);');

    try {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: coldUserEmail, password: coldUserPassword })
      });

      assert.equal(res.status, 500, 'Must return 500 on database failure');
      const body = await res.json();
      assert.equal(body.code, 'DATABASE_AUTH_LOOKUP_FAILED');
    } finally {
      // Restore function
      await superuserPool.query(`
        CREATE OR REPLACE FUNCTION lookup_user_for_auth(p_email text)
        RETURNS TABLE (
          id uuid,
          name text,
          email text,
          password_hash text,
          status text
        )
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        STABLE
        AS $$
          SELECT u.id, u.name, u.email, u.password_hash, u.status
          FROM users u
          WHERE lower(u.email) = lower(p_email);
        $$;
        ALTER FUNCTION lookup_user_for_auth(text) OWNER TO operza_auth_definer;
        GRANT EXECUTE ON FUNCTION lookup_user_for_auth(text) TO operza_app;
      `);
    }
  });

  // Scenario 6: RLS context ordering: Membership query succeeds under configured app.user_id
  await t.test('Scenario 6: RLS context ordering permits membership lookup under app.user_id', async () => {
    const parsedUrl = new URL(dbUrl);
    const appPool = new pg.Pool({
      connectionString: `postgresql://operza_app:operza_app_secret@${parsedUrl.hostname}:${parsedUrl.port}/${parsedUrl.pathname.replace(/^\//, '')}`,
      max: 2
    });

    try {
      const client = await appPool.connect();
      try {
        await client.query('BEGIN');
        // Without app.user_id: 0 rows returned due to RLS
        const unauthedRes = await client.query('SELECT id FROM agency_memberships WHERE user_id = $1', [coldUserFixture.userId]);
        assert.equal(unauthedRes.rows.length, 0, 'Must fail closed with 0 rows before setting context');

        // Setting app.user_id allows user to read their own membership
        await client.query("SELECT set_config('app.user_id', $1, true)", [coldUserFixture.userId]);
        const authedRes = await client.query('SELECT id FROM agency_memberships WHERE user_id = $1', [coldUserFixture.userId]);
        assert.equal(authedRes.rows.length, 1, 'Must return membership row once app.user_id is set');

        await client.query('COMMIT');
      } finally {
        client.release();
      }
    } finally {
      await appPool.end();
    }
  });

  // Scenario 7: Missing membership returns 403 NO_ACTIVE_MEMBERSHIP
  await t.test('Scenario 7: Missing membership returns 403 NO_ACTIVE_MEMBERSHIP', async () => {
    const noMemEmail = 'no-membership@example.com';
    const noMemPassword = 'Password123!';
    await seedUserFixture(superuserPool, {
      email: noMemEmail,
      password: noMemPassword,
      includeMembership: false
    });

    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: noMemEmail, password: noMemPassword })
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'NO_ACTIVE_MEMBERSHIP');
  });

  // Scenario 8: Revoked membership returns 403 NO_ACTIVE_MEMBERSHIP
  await t.test('Scenario 8: Revoked membership returns 403 NO_ACTIVE_MEMBERSHIP', async () => {
    const revokedMemEmail = 'revoked-mem@example.com';
    const revokedMemPassword = 'Password123!';
    await seedUserFixture(superuserPool, {
      email: revokedMemEmail,
      password: revokedMemPassword,
      membershipStatus: 'inactive'
    });

    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: revokedMemEmail, password: revokedMemPassword })
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'NO_ACTIVE_MEMBERSHIP');
  });

  // Scenario 9: Revoked user returns 401 USER_INACTIVE
  await t.test('Scenario 9: Revoked user returns 401 USER_INACTIVE', async () => {
    const suspendedEmail = 'suspended-user@example.com';
    const suspendedPassword = 'Password123!';
    await seedUserFixture(superuserPool, {
      email: suspendedEmail,
      password: suspendedPassword,
      userStatus: 'inactive'
    });

    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: suspendedEmail, password: suspendedPassword })
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'USER_INACTIVE');
  });

  // Scenario 10: Suspended agency returns 403 AGENCY_INACTIVE
  await t.test('Scenario 10: Suspended agency returns 403 AGENCY_INACTIVE', async () => {
    const suspendedAgencyEmail = 'agency-suspended@example.com';
    const suspendedAgencyPassword = 'Password123!';
    await seedUserFixture(superuserPool, {
      email: suspendedAgencyEmail,
      password: suspendedAgencyPassword,
      agencyStatus: 'suspended'
    });

    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: suspendedAgencyEmail, password: suspendedAgencyPassword })
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'AGENCY_INACTIVE');
  });

  // Scenario 11: Inactive location returns 403 NO_ACTIVE_LOCATIONS
  await t.test('Scenario 11: Inactive location returns 403 NO_ACTIVE_LOCATIONS', async () => {
    const inactiveLocEmail = 'inactive-loc@example.com';
    const inactiveLocPassword = 'Password123!';
    await seedUserFixture(superuserPool, {
      email: inactiveLocEmail,
      password: inactiveLocPassword,
      locationStatus: 'inactive'
    });

    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inactiveLocEmail, password: inactiveLocPassword })
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'NO_ACTIVE_LOCATIONS');
  });

  // Scenario 12: Stale session in memory revoked in DB -> GET /api/auth/session returns 401
  await t.test('Scenario 12: Session revoked in PostgreSQL is rejected even if cached in memory', async () => {
    // Login to populate memory cache and PostgreSQL
    const resLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: coldUserEmail, password: coldUserPassword })
    });
    assert.equal(resLogin.status, 200);

    const cookies = resLogin.headers.getSetCookie ? resLogin.headers.getSetCookie() : [resLogin.headers.get('set-cookie')].filter(Boolean);
    const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

    // Verify session works
    const resActive = await fetch(`${BASE_URL}/api/auth/session`, {
      headers: { Cookie: cookieHeader }
    });
    assert.equal(resActive.status, 200, 'Session should be active initially');

    // Revoke session directly in PostgreSQL
    await superuserPool.query('DELETE FROM auth_sessions WHERE user_id = $1', [coldUserFixture.userId]);

    // Subsequent call must fail with 401 - memory cache must NOT authorize
    const resRevoked = await fetch(`${BASE_URL}/api/auth/session`, {
      headers: { Cookie: cookieHeader }
    });
    assert.equal(resRevoked.status, 401, 'Revoked PostgreSQL session must return 401');
  });

  // Scenario 13: Session lookup after API restart (cold memory)
  await t.test('Scenario 13: Session lookup succeeds after API restart from authoritative PostgreSQL', async () => {
    // 1. Log in fresh to create a valid DB session
    const resLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: coldUserEmail, password: coldUserPassword })
    });
    assert.equal(resLogin.status, 200);

    const cookies = resLogin.headers.getSetCookie ? resLogin.headers.getSetCookie() : [resLogin.headers.get('set-cookie')].filter(Boolean);
    const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

    // 2. Restart API Server (wipes memory state)
    await stopServer();
    await startServer();

    // 3. Request session with existing cookie
    const resAfterRestart = await fetch(`${BASE_URL}/api/auth/session`, {
      headers: { Cookie: cookieHeader }
    });
    assert.equal(resAfterRestart.status, 200, 'Session must be restored from PostgreSQL after cold restart');
    const body = await resAfterRestart.json();
    assert.equal(body.user.email, coldUserEmail);
  });

  // Scenario 14: PostgreSQL error on resolve_auth_session fails closed in staging/prod
  await t.test('Scenario 14: Database error on resolve_auth_session fails closed (401)', async () => {
    // 1. Log in to establish valid session
    const resLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: coldUserEmail, password: coldUserPassword })
    });
    assert.equal(resLogin.status, 200);

    const cookies = resLogin.headers.getSetCookie ? resLogin.headers.getSetCookie() : [resLogin.headers.get('set-cookie')].filter(Boolean);
    const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

    // 2. Temporarily break resolve_auth_session in PostgreSQL
    await superuserPool.query('DROP FUNCTION resolve_auth_session(text);');

    try {
      // 3. Must return 401 (fail closed, do not authorize from memory cache)
      const resDbError = await fetch(`${BASE_URL}/api/auth/session`, {
        headers: { Cookie: cookieHeader }
      });
      assert.equal(resDbError.status, 401, 'Must fail closed with 401 when DB query fails');
    } finally {
      // Restore resolve_auth_session
      await superuserPool.query(`
        CREATE OR REPLACE FUNCTION resolve_auth_session(p_token_hash text)
        RETURNS TABLE (
          id uuid,
          token_hash text,
          csrf_hash text,
          user_id uuid,
          agency_id uuid,
          expires_at_ms double precision,
          user_name text,
          user_email text,
          user_status text,
          agency_name text,
          agency_slug text,
          agency_status text
        )
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        STABLE
        AS $$
          SELECT s.id, s.token_hash, s.csrf_hash, s.user_id, s.agency_id,
                 extract(epoch from s.expires_at) * 1000 AS expires_at_ms,
                 u.name as user_name, u.email as user_email, u.status as user_status,
                 a.name as agency_name, a.slug as agency_slug, a.status as agency_status
          FROM auth_sessions s
          JOIN users u ON u.id = s.user_id
          JOIN agencies a ON a.id = s.agency_id
          WHERE s.token_hash = p_token_hash AND s.expires_at > now();
        $$;
        ALTER FUNCTION resolve_auth_session(text) OWNER TO operza_auth_definer;
        GRANT EXECUTE ON FUNCTION resolve_auth_session(text) TO operza_app;
      `);
    }
  });

  // Scenario 15: Cross-location authorization via header
  await t.test('Scenario 15: Header x-operza-location rejects unauthorized locations', async () => {
    // 1. Seed two locations for cold user
    const loc2Id = randomUUID();
    await superuserPool.query(
      'INSERT INTO locations (id, agency_id, name, status) VALUES ($1, $2, $3, $4)',
      [loc2Id, coldUserFixture.agencyId, 'Branch Office', 'active']
    );

    // 2. Log in
    const resLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: coldUserEmail, password: coldUserPassword })
    });
    assert.equal(resLogin.status, 200);

    const cookies = resLogin.headers.getSetCookie ? resLogin.headers.getSetCookie() : [resLogin.headers.get('set-cookie')].filter(Boolean);
    const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

    // 3. Request with valid Location 2 in header -> 200 and activeLocation = Location 2
    const resValidLoc = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: {
        Cookie: cookieHeader,
        'x-operza-location': loc2Id
      }
    });
    assert.equal(resValidLoc.status, 200);
    const bodyValid = await resValidLoc.json();
    assert.equal(bodyValid.activeLocation.id, loc2Id);

    // 4. Request with unauthorized/foreign location -> 401
    const foreignLocId = randomUUID();
    const resInvalidLoc = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: {
        Cookie: cookieHeader,
        'x-operza-location': foreignLocId
      }
    });
    assert.equal(resInvalidLoc.status, 401, 'Unauthorized location header must return 401');
  });

  // Scenario 16: User has no active agency memberships in PostgreSQL fails closed (403)
  await t.test('Scenario 16: User with no active agency memberships in PostgreSQL fails closed (403 NO_ACTIVE_MEMBERSHIP)', async () => {
    const orphanEmail = 'orphan-user@example.com';
    const orphanPassword = 'OrphanPassword123!';
    await seedUserFixture(superuserPool, {
      email: orphanEmail,
      password: orphanPassword,
      includeMembership: false
    });

    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: orphanEmail, password: orphanPassword })
    });

    assert.equal(res.status, 403, 'Must return 403 when user has no active agency membership in PostgreSQL');
    const body = await res.json();
    assert.equal(body.code || body.error, 'NO_ACTIVE_MEMBERSHIP');
  });

  // Scenario 17: User agency is suspended in PostgreSQL fails closed (403)
  await t.test('Scenario 17: User whose agency is inactive in PostgreSQL fails closed (403 AGENCY_INACTIVE)', async () => {
    const suspendedEmail = 'suspended-agency-user@example.com';
    const suspendedPassword = 'SuspendedPassword123!';
    await seedUserFixture(superuserPool, {
      email: suspendedEmail,
      password: suspendedPassword,
      agencyStatus: 'suspended'
    });

    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: suspendedEmail, password: suspendedPassword })
    });

    assert.equal(res.status, 403, 'Must return 403 when user agency is suspended');
    const body = await res.json();
    assert.equal(body.code || body.error, 'AGENCY_INACTIVE');
  });

  // Scenario 18: Inactive user in PostgreSQL fails closed (401 USER_INACTIVE)
  await t.test('Scenario 18: Inactive user in PostgreSQL fails closed (401 USER_INACTIVE)', async () => {
    const inactiveEmail = 'inactive-user-test@example.com';
    const inactivePassword = 'InactivePassword123!';
    await seedUserFixture(superuserPool, {
      email: inactiveEmail,
      password: inactivePassword,
      userStatus: 'inactive'
    });

    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inactiveEmail, password: inactivePassword })
    });

    assert.equal(res.status, 401, 'Must return 401 when user status is inactive');
    const body = await res.json();
    assert.equal(body.code || body.error, 'USER_INACTIVE');
  });
});
