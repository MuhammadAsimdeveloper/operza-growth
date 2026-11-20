import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatedTestPostgres } from '../lib/test-postgres-server.mjs';
import {
  runPrivilegedBootstrap,
  runUnprivilegedMigrations,
  runMigrationPipeline,
  verifyRolesAndAttributes,
  DEFAULT_MIGRATOR_PASSWORD,
  STANDARD_SECURITY_ROLE_OPTIONS
} from '../scripts/migrate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

process.env.NODE_ENV = 'test';

test('Phase 20.2.5.11: Production Migration Pipeline & Privilege Boundary Integrity', async (t) => {
  // 1. Provision fresh isolated PostgreSQL database
  const pgServer = new IsolatedTestPostgres({ port: 5436, dbName: 'operza_prod_migrator_test' });
  const adminDbUrl = await pgServer.start();

  const { default: pg } = await import('pg');
  const superuserPool = new pg.Pool({ connectionString: adminDbUrl, max: 5 });
  superuserPool.on('error', () => {});

  let migratorPool;

  t.after(async () => {
    if (migratorPool) {
      await migratorPool.end().catch(() => {});
    }
    await superuserPool.end().catch(() => {});
    await pgServer.stop().catch(() => {});
  });

  const parsedUrl = new URL(adminDbUrl);
  const host = parsedUrl.hostname;
  const port = parsedUrl.port;
  const dbName = parsedUrl.pathname.replace(/^\//, '');

  const migratorPassword = DEFAULT_MIGRATOR_PASSWORD;
  const migratorDbUrl = `postgresql://operza_migrator:${migratorPassword}@${host}:${port}/${dbName}`;

  // STEP 2: Perform Stage A (Privileged Bootstrap) using administrative superuser connection
  await t.test('1. Stage A: Run privileged bootstrap via production runPrivilegedBootstrap()', async () => {
    await runPrivilegedBootstrap(superuserPool, {
      migratorPassword
    });

    // Verify all roles and attributes fail closed
    await verifyRolesAndAttributes(superuserPool);
  });

  // Stage A session safety & multi-connection admin pool regression test with CREATE and ALTER path verification
  await t.test('1b. Stage A Session Safety: Multi-connection admin pool executes reliably with dedicated session client', async () => {
    // Instantiate a pristine dedicated PostgreSQL server for this test so that operza_worker does not exist
    // and can be tested through its genuine initial CREATE path followed by the ALTER path.
    const lifecycleDataDir = path.join(root, 'scratch', 'test-role-lifecycle-cluster-5494');
    rmSync(lifecycleDataDir, { recursive: true, force: true });
    const lifecycleServer = new IsolatedTestPostgres({
      port: 5494,
      dbName: 'operza_role_lifecycle_test',
      dataDir: lifecycleDataDir,
      skipRoleBootstrap: true,
      forceIsolatedCluster: true
    });
    const lifecycleAdminUrl = await lifecycleServer.start();
    const lifecycleParsed = new URL(lifecycleAdminUrl);
    const lifecycleHost = lifecycleParsed.hostname || '127.0.0.1';
    const lifecyclePort = lifecycleParsed.port || '5494';
    const lifecycleDb = lifecycleParsed.pathname.slice(1);

    // Enforce scram-sha-256 password authentication for operza_worker in pg_hba.conf if local cluster
    const hbaPath = path.join(lifecycleDataDir, 'pg_hba.conf');
    if (existsSync(hbaPath)) {
      const existingHba = readFileSync(hbaPath, 'utf8');
      writeFileSync(
        hbaPath,
        'host all operza_worker 127.0.0.1/32 scram-sha-256\nhost all operza_worker ::1/128 scram-sha-256\n' + existingHba,
        'utf8'
      );
    }

    const multiAdminPool = new pg.Pool({
      connectionString: lifecycleAdminUrl,
      max: 10
    });

    // Reload configuration to activate scram-sha-256 rule for operza_worker
    await multiAdminPool.query('SELECT pg_reload_conf();');

    const recordedSessionPids = [];
    let probeExecuted = false;

    // Verify operza_worker genuinely does not exist before probe invocation
    const preCheckWorker = await multiAdminPool.query("SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker';");
    assert.equal(preCheckWorker.rowCount, 0, 'operza_worker must not exist before CREATE path test');

    try {
      // Re-run privileged bootstrap using an admin pool with 10 available connections,
      // instrumenting via the capability-based restricted invoker with explicit test opt-in
      await runPrivilegedBootstrap(multiAdminPool, {
        migratorPassword,
        workerPassword: 'bootstrap_worker_final_pass',
        allowTestProbe: true,
        recordedSessionPids,
        roleProvisioningProbe: async (restrictedInvoker, expectedPid) => {
          probeExecuted = true;

          // 1. Prove that the probe is running on the exact same backend PID session as the bootstrap
          const probePid = await restrictedInvoker.getBackendPid();
          assert.equal(probePid, expectedPid, 'Probe must execute on the exact same backend session PID as Stage A bootstrap');

          // 2. Adversarial input validation (All rejections must fail closed with SQLSTATE 42501)
          // 2a. NULL role name
          await assert.rejects(
            () => restrictedInvoker.invoke(null, 'pass123', STANDARD_SECURITY_ROLE_OPTIONS),
            (err) => err.code === '42501' && /Role name cannot be NULL or empty/i.test(err.message),
            'Must reject NULL role name with SQLSTATE 42501'
          );

          // 2b. Empty & whitespace-only role name
          await assert.rejects(
            () => restrictedInvoker.invoke('', 'pass123', STANDARD_SECURITY_ROLE_OPTIONS),
            (err) => err.code === '42501' && /Role name cannot be NULL or empty/i.test(err.message),
            'Must reject empty role name with SQLSTATE 42501'
          );
          await assert.rejects(
            () => restrictedInvoker.invoke('   ', 'pass123', STANDARD_SECURITY_ROLE_OPTIONS),
            (err) => err.code === '42501' && /Role name cannot be NULL or empty/i.test(err.message),
            'Must reject whitespace-only role name with SQLSTATE 42501'
          );

          // 2c. NULL password
          await assert.rejects(
            () => restrictedInvoker.invoke('operza_app', null, STANDARD_SECURITY_ROLE_OPTIONS),
            (err) => err.code === '42501' && /Password cannot be NULL or empty/i.test(err.message),
            'Must reject NULL password with SQLSTATE 42501'
          );

          // 2d. Empty & whitespace-only password
          await assert.rejects(
            () => restrictedInvoker.invoke('operza_app', '', STANDARD_SECURITY_ROLE_OPTIONS),
            (err) => err.code === '42501' && /Password cannot be NULL or empty/i.test(err.message),
            'Must reject empty password with SQLSTATE 42501'
          );
          await assert.rejects(
            () => restrictedInvoker.invoke('operza_app', '   ', STANDARD_SECURITY_ROLE_OPTIONS),
            (err) => err.code === '42501' && /Password cannot be NULL or empty/i.test(err.message),
            'Must reject whitespace-only password with SQLSTATE 42501'
          );

          // 2e. NULL options
          await assert.rejects(
            () => restrictedInvoker.invoke('operza_app', 'pass123', null),
            (err) => err.code === '42501' && /Role options cannot be NULL or empty/i.test(err.message),
            'Must reject NULL options with SQLSTATE 42501'
          );

          // 2f. Empty & whitespace-only options
          await assert.rejects(
            () => restrictedInvoker.invoke('operza_app', 'pass123', ''),
            (err) => err.code === '42501' && /Role options cannot be NULL or empty/i.test(err.message),
            'Must reject empty options with SQLSTATE 42501'
          );
          await assert.rejects(
            () => restrictedInvoker.invoke('operza_app', 'pass123', '   '),
            (err) => err.code === '42501' && /Role options cannot be NULL or empty/i.test(err.message),
            'Must reject whitespace-only options with SQLSTATE 42501'
          );

          // 2g. Disallowed role options: SUPERUSER, CREATEDB, CREATEROLE, BYPASSRLS, INHERIT
          await assert.rejects(
            () => restrictedInvoker.invoke('operza_app', 'pass123', 'SUPERUSER'),
            (err) => err.code === '42501' && /Disallowed role options/i.test(err.message),
            'Must reject SUPERUSER option with SQLSTATE 42501'
          );
          await assert.rejects(
            () => restrictedInvoker.invoke('operza_app', 'pass123', 'CREATEDB NOSUPERUSER NOCREATEROLE NOINHERIT NOBYPASSRLS'),
            (err) => err.code === '42501' && /Disallowed role options/i.test(err.message),
            'Must reject CREATEDB option with SQLSTATE 42501'
          );
          await assert.rejects(
            () => restrictedInvoker.invoke('operza_app', 'pass123', 'CREATEROLE NOSUPERUSER NOCREATEDB NOINHERIT NOBYPASSRLS'),
            (err) => err.code === '42501' && /Disallowed role options/i.test(err.message),
            'Must reject CREATEROLE option with SQLSTATE 42501'
          );
          await assert.rejects(
            () => restrictedInvoker.invoke('operza_app', 'pass123', 'BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT'),
            (err) => err.code === '42501' && /Disallowed role options/i.test(err.message),
            'Must reject BYPASSRLS option with SQLSTATE 42501'
          );
          await assert.rejects(
            () => restrictedInvoker.invoke('operza_app', 'pass123', 'INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'),
            (err) => err.code === '42501' && /Disallowed role options/i.test(err.message),
            'Must reject INHERIT option with SQLSTATE 42501'
          );

          // 2h. Unauthorized role names
          await assert.rejects(
            () => restrictedInvoker.invoke('postgres', 'pass123', STANDARD_SECURITY_ROLE_OPTIONS),
            (err) => err.code === '42501' && /Disallowed role name/i.test(err.message),
            'Must reject postgres role with SQLSTATE 42501'
          );
          await assert.rejects(
            () => restrictedInvoker.invoke('admin', 'pass123', STANDARD_SECURITY_ROLE_OPTIONS),
            (err) => err.code === '42501' && /Disallowed role name/i.test(err.message),
            'Must reject admin role with SQLSTATE 42501'
          );
          await assert.rejects(
            () => restrictedInvoker.invoke('unauthorized_role_test', 'pass123', STANDARD_SECURITY_ROLE_OPTIONS),
            (err) => err.code === '42501' && /Disallowed role name/i.test(err.message),
            'Must reject unauthorized role name with SQLSTATE 42501'
          );

          // 2i. SQL injection attempts in role name and options
          await assert.rejects(
            () => restrictedInvoker.invoke("operza_app'; DROP ROLE operza_app; --", 'pass123', STANDARD_SECURITY_ROLE_OPTIONS),
            (err) => err.code === '42501' && /Disallowed role name/i.test(err.message),
            'Must reject SQL injection in role name with SQLSTATE 42501'
          );
          await assert.rejects(
            () => restrictedInvoker.invoke('operza_app', 'pass123', "NOSUPERUSER; CREATE ROLE hacked_role;"),
            (err) => err.code === '42501' && /Disallowed role options/i.test(err.message),
            'Must reject SQL injection in options with SQLSTATE 42501'
          );

          // 3. GENUINE CREATE PATH: operza_worker does not exist yet
          const initialWorkerPass = 'worker_initial_create_pass_123';
          await restrictedInvoker.invoke('operza_worker', initialWorkerPass, STANDARD_SECURITY_ROLE_OPTIONS);

          // Verify role was created and attributes strictly match least privilege
          const createdWorkerRes = await multiAdminPool.query(`
            SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit
            FROM pg_roles
            WHERE rolname = 'operza_worker';
          `);
          assert.equal(createdWorkerRes.rowCount, 1, 'operza_worker must be created by CREATE path');
          const createdWorker = createdWorkerRes.rows[0];
          assert.equal(createdWorker.rolcanlogin, true, 'Created role must have LOGIN');
          assert.equal(createdWorker.rolsuper, false, 'Created role must NOT be SUPERUSER');
          assert.equal(createdWorker.rolcreatedb, false, 'Created role must NOT have CREATEDB');
          assert.equal(createdWorker.rolcreaterole, false, 'Created role must NOT have CREATEROLE');
          assert.equal(createdWorker.rolinherit, false, 'Created role must have NOINHERIT');
          assert.equal(createdWorker.rolbypassrls, false, 'Created role must NOT have BYPASSRLS');

          // Record initial SCRAM password verifier from pg_authid
          const initialHashRes = await multiAdminPool.query("SELECT rolpassword FROM pg_authid WHERE rolname = 'operza_worker';");
          const initialHash = initialHashRes.rows[0].rolpassword;
          assert.ok(initialHash && initialHash.startsWith('SCRAM-SHA-256$'), 'Password hash must be stored as SCRAM-SHA-256');

          // Verify created role can authenticate with initial password
          const initialAuthPool = new pg.Pool({
            connectionString: `postgresql://operza_worker:${initialWorkerPass}@${lifecycleHost}:${lifecyclePort}/${lifecycleDb}`,
            max: 1
          });
          try {
            const authCheck = await initialAuthPool.query('SELECT current_user;');
            assert.equal(authCheck.rows[0].current_user, 'operza_worker');
          } finally {
            await initialAuthPool.end();
          }

          // 4. GENUINE ALTER PATH: operza_worker already exists; update password
          const updatedWorkerPass = 'worker_updated_alter_pass_456';
          await restrictedInvoker.invoke('operza_worker', updatedWorkerPass, STANDARD_SECURITY_ROLE_OPTIONS);

          // Verify that the stored password hash in pg_authid was updated
          const updatedHashRes = await multiAdminPool.query("SELECT rolpassword FROM pg_authid WHERE rolname = 'operza_worker';");
          const updatedHash = updatedHashRes.rows[0].rolpassword;
          assert.ok(updatedHash && updatedHash.startsWith('SCRAM-SHA-256$'), 'Updated password hash must be SCRAM-SHA-256');
          assert.notEqual(initialHash, updatedHash, 'Password verifier in pg_authid must change upon ALTER update');

          // Verify updated password works and old password is rejected
          const updatedAuthPool = new pg.Pool({
            connectionString: `postgresql://operza_worker:${updatedWorkerPass}@${lifecycleHost}:${lifecyclePort}/${lifecycleDb}`,
            max: 1
          });
          try {
            const authCheck2 = await updatedAuthPool.query('SELECT current_user;');
            assert.equal(authCheck2.rows[0].current_user, 'operza_worker');
          } finally {
            await updatedAuthPool.end();
          }

          const oldAuthPool = new pg.Pool({
            connectionString: `postgresql://operza_worker:${initialWorkerPass}@${lifecycleHost}:${lifecyclePort}/${lifecycleDb}`,
            max: 1
          });
          try {
            await assert.rejects(
              () => oldAuthPool.query('SELECT current_user;'),
              /password authentication failed/i,
              'Old password must be rejected after ALTER path update'
            );
          } finally {
            await oldAuthPool.end();
          }

          // Verify security attributes were NOT weakened by ALTER path
          const alteredWorkerRes = await multiAdminPool.query(`
            SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit
            FROM pg_roles
            WHERE rolname = 'operza_worker';
          `);
          const alteredWorker = alteredWorkerRes.rows[0];
          assert.equal(alteredWorker.rolcanlogin, true);
          assert.equal(alteredWorker.rolsuper, false);
          assert.equal(alteredWorker.rolcreatedb, false);
          assert.equal(alteredWorker.rolcreaterole, false);
          assert.equal(alteredWorker.rolinherit, false);
          assert.equal(alteredWorker.rolbypassrls, false);
        }
      });

      assert.equal(probeExecuted, true, 'Stage A test probe must have executed against the live session');

      // Verify that all commands during Stage A used the exact same backend PID
      assert.ok(recordedSessionPids.length >= 3, 'Must have recorded session PIDs throughout Stage A sequence');
      const firstPid = recordedSessionPids[0];
      for (const pid of recordedSessionPids) {
        assert.equal(pid, firstPid, `All Stage A commands must share identical backend PID (${firstPid}), found ${pid}`);
      }

      // Verify roles and attributes are intact after bootstrap completion
      await verifyRolesAndAttributes(multiAdminPool);
    } finally {
      await multiAdminPool.end();
      await lifecycleServer.stop();
      rmSync(lifecycleDataDir, { recursive: true, force: true });
    }
  });

  // STEP 3: Configure actual unprivileged operza_migrator connection
  await t.test('2. Stage B Identity: Connect as operza_migrator and assert current_user', async () => {
    migratorPool = new pg.Pool({ connectionString: migratorDbUrl, max: 5 });
    migratorPool.on('error', () => {});

    const res = await migratorPool.query('SELECT current_user, session_user;');
    assert.equal(res.rows[0].current_user, 'operza_migrator', 'current_user must strictly be operza_migrator');
    assert.equal(res.rows[0].session_user, 'operza_migrator', 'session_user must strictly be operza_migrator');
  });

  // STEP 4 & 5: Invoke actual production runUnprivilegedMigrations() against real migrations directory
  await t.test('3. Production Runner: Execute runUnprivilegedMigrations() across full suite (001-027)', async () => {
    await runUnprivilegedMigrations(migratorPool, { directory: migrationsDir });

    // Assert all 27 migrations are applied
    const files = (await readdir(migrationsDir))
      .filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
      .sort();

    assert.equal(files.length >= 27, true, `Expected at least 27 migrations, found ${files.length}`);

    // STEP 6: Verify every schema_migrations entry
    const appliedRes = await migratorPool.query('SELECT name, applied_at FROM schema_migrations ORDER BY name;');
    assert.equal(appliedRes.rowCount, files.length, `schema_migrations must contain exactly ${files.length} records`);

    for (let i = 0; i < files.length; i++) {
      assert.equal(appliedRes.rows[i].name, files[i], `Migration at index ${i} must match ${files[i]}`);
      assert.ok(appliedRes.rows[i].applied_at, `Migration ${files[i]} must have a valid applied_at timestamp`);
    }
  });

  // STEP 7: Verify all migrations executed as operza_migrator
  await t.test('4. Migration Execution Identity: Tables and objects created by operza_migrator', async () => {
    const tableRes = await migratorPool.query(`
      SELECT tableowner, count(*) AS tbl_count
      FROM pg_tables
      WHERE schemaname = 'public'
      GROUP BY tableowner;
    `);

    assert.ok(tableRes.rowCount >= 1, 'Tables must exist in public schema');
    const ownerMap = new Map(tableRes.rows.map(r => [r.tableowner, parseInt(r.tbl_count, 10)]));
    assert.ok(ownerMap.has('operza_migrator'), 'operza_migrator must be tableowner of migrated tables');
    assert.ok(ownerMap.get('operza_migrator') > 20, 'operza_migrator must own the core application tables');
  });

  // STEP 8: Verify all five security-definer helper functions are owned by operza_auth_definer
  await t.test('5. Definer Function Ownership: All five functions owned by operza_auth_definer', async () => {
    const expectedSignatures = new Map([
      ['resolve_auth_session(text)', 'operza_auth_definer'],
      ['lookup_user_for_auth(text)', 'operza_auth_definer'],
      ['lookup_public_calendar(text)', 'operza_auth_definer'],
      ['expire_pending_workflow_approvals()', 'operza_auth_definer'],
      ['expire_tenant_workflow_approvals(uuid, uuid)', 'operza_auth_definer']
    ]);

    const res = await migratorPool.query(`
      SELECT 
        p.proname,
        format('%s(%s)', p.proname, oidvectortypes(p.proargtypes)) AS signature,
        r.rolname AS owner
      FROM pg_proc p
      JOIN pg_roles r ON p.proowner = r.oid
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'resolve_auth_session',
          'lookup_user_for_auth',
          'lookup_public_calendar',
          'expire_pending_workflow_approvals',
          'expire_tenant_workflow_approvals'
        )
      ORDER BY p.proname;
    `);

    assert.equal(res.rowCount, 5, 'Exactly five security-definer functions must exist in public schema');
    const foundMap = new Map(res.rows.map(r => [r.signature, r.owner]));

    for (const [signature, expectedOwner] of expectedSignatures.entries()) {
      assert.ok(foundMap.has(signature), `Required function signature "${signature}" must exist in schema public`);
      const actualOwner = foundMap.get(signature);
      assert.equal(actualOwner, expectedOwner, `Function "${signature}" must be owned by "${expectedOwner}", got "${actualOwner}"`);
    }
  });

  // STEP 9: Verify role attributes and RLS properties remain intact
  await t.test('6. Security Attributes & Forced RLS: Attributes and tenant isolation intact', async () => {
    // Assert role attributes
    await verifyRolesAndAttributes(migratorPool);

    // Assert forced RLS on core tenant tables
    const rlsRes = await migratorPool.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('agencies', 'locations', 'users', 'agency_memberships', 'workflow_executions', 'workflow_definitions')
      ORDER BY relname;
    `);

    assert.equal(rlsRes.rowCount, 6, 'Core tenant tables must exist and be queried for RLS attributes');
    for (const r of rlsRes.rows) {
      assert.equal(r.relrowsecurity, true, `Table ${r.relname} must have ROW LEVEL SECURITY enabled`);
      assert.equal(r.relforcerowsecurity, true, `Table ${r.relname} must have FORCE ROW LEVEL SECURITY enabled`);
    }
  });

  // STEP 10: Run the migration process a second time and prove idempotency
  await t.test('7. Production Runner Idempotency: Second run applies 0 new files, zero corruption', async () => {
    // Capture state before second run
    const beforeRes = await migratorPool.query('SELECT name, applied_at FROM schema_migrations ORDER BY name;');

    // Run production runner a second time
    await runUnprivilegedMigrations(migratorPool, { directory: migrationsDir });

    // Capture state after second run
    const afterRes = await migratorPool.query('SELECT name, applied_at FROM schema_migrations ORDER BY name;');

    assert.equal(afterRes.rowCount, beforeRes.rowCount, 'No duplicate migration entries should be created');
    for (let i = 0; i < beforeRes.rowCount; i++) {
      assert.equal(afterRes.rows[i].name, beforeRes.rows[i].name, `Migration name mismatch at index ${i}`);
      assert.equal(
        afterRes.rows[i].applied_at.getTime(),
        beforeRes.rows[i].applied_at.getTime(),
        `Migration timestamp at index ${i} should be unchanged`
      );
    }
  });

  // REQUIREMENT 2 & 5: Exact Active NOCREATEROLE probe & fail-visible security operations
  await t.test('8. Active Probe & NOCREATEROLE: Probe asserts exact SQLSTATE 42501 (insufficient_privilege)', async () => {
    const probeRole = `__test_probe_role_${Date.now()}`;
    let thrownError = null;

    try {
      await migratorPool.query(`CREATE ROLE ${probeRole};`);
    } catch (err) {
      thrownError = err;
    }

    assert.ok(thrownError, 'CREATE ROLE must throw an error under operza_migrator');
    assert.equal(thrownError.code, '42501', `Must throw SQLSTATE 42501 (insufficient_privilege), got ${thrownError.code}`);
    assert.match(thrownError.message, /permission denied to create role/i);
  });

  // REQUIREMENT 3: Stage A privilege preconditions (Superuser required, CREATEROLE alone fails)
  await t.test('9. Stage A Preconditions: Superuser succeeds, CREATEROLE-only admin fails closed', async () => {
    // Provision a role with CREATEROLE but NOT superuser
    await superuserPool.query(`
      DROP ROLE IF EXISTS test_createrole_only_admin;
      CREATE ROLE test_createrole_only_admin LOGIN PASSWORD 'cr_pass_test' NOSUPERUSER CREATEROLE NOCREATEDB;
      GRANT ALL ON DATABASE "${dbName}" TO test_createrole_only_admin;
    `);

    const createrolePool = new pg.Pool({
      connectionString: `postgresql://test_createrole_only_admin:cr_pass_test@${host}:${port}/${dbName}`,
      max: 1
    });

    try {
      await assert.rejects(
        () => runPrivilegedBootstrap(createrolePool),
        /\[STAGE-A\] PRIVILEGE_ERROR.*lacks SUPERUSER privileges/i,
        'Stage A must reject an administrative identity lacking SUPERUSER privileges'
      );
    } finally {
      await createrolePool.end();
      await superuserPool.query(`
        REVOKE ALL ON DATABASE "${dbName}" FROM test_createrole_only_admin;
        DROP OWNED BY test_createrole_only_admin;
        DROP ROLE IF EXISTS test_createrole_only_admin;
      `);
    }
  });

  // REQUIREMENT 4: Safe password handling with quotes and special characters
  await t.test('10. Safe Password Handling: Passwords with quotes, dollar signs, and semicolons', async () => {
    const complexSpecialPassword = "p@$$w0rd'with\"quotes;--and$dollar$";

    // Re-run Stage A bootstrap with complex special character password
    await runPrivilegedBootstrap(superuserPool, {
      migratorPassword: complexSpecialPassword
    });

    // Connect using the complex special character password
    const specialMigratorPool = new pg.Pool({
      connectionString: `postgresql://operza_migrator:${encodeURIComponent(complexSpecialPassword)}@${host}:${port}/${dbName}`,
      max: 1
    });

    try {
      const authRes = await specialMigratorPool.query('SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;');
      assert.equal(authRes.rows[0].current_user, 'operza_migrator');
      assert.equal(authRes.rows[0].rolsuper, false);
      assert.equal(authRes.rows[0].rolbypassrls, false);
    } finally {
      await specialMigratorPool.end();
      // Restore standard test password
      await runPrivilegedBootstrap(superuserPool, { migratorPassword });
    }
  });

  // REQUIREMENT 1: Test runMigrationPipeline() end-to-end wrapper on a fresh database
  await t.test('11. Full Wrapper Execution: runMigrationPipeline() runs Stage A & B end-to-end', async () => {
    const pipelineServer = new IsolatedTestPostgres({ port: 5434, dbName: 'operza_pipeline_wrapper_test' });
    const pipelineAdminUrl = await pipelineServer.start();

    try {
      await runMigrationPipeline({
        adminUrl: pipelineAdminUrl,
        migratorPassword: 'pipeline_runner_secret'
      });

      // Verify migration succeeded on the new database
      const parsed = new URL(pipelineAdminUrl);
      const migratorUrl = `postgresql://operza_migrator:pipeline_runner_secret@${parsed.hostname}:${parsed.port}/${parsed.pathname.replace(/^\//, '')}`;
      const checkPool = new pg.Pool({ connectionString: migratorUrl, max: 1 });
      try {
        const countRes = await checkPool.query('SELECT count(*) AS total FROM schema_migrations;');
        assert.ok(parseInt(countRes.rows[0].total, 10) >= 27, 'Pipeline wrapper must have applied all migrations');
      } finally {
        await checkPool.end();
      }
    } finally {
      await pipelineServer.stop();
    }
  });

  // NEGATIVE CASES & ERROR INTEGRITY
  await t.test('12. Negative Case: Unprivileged role without role membership cannot transfer ownership', async () => {
    await superuserPool.query(`
      DROP ROLE IF EXISTS test_non_member_runner;
      CREATE ROLE test_non_member_runner LOGIN PASSWORD 'non_member_pass' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      GRANT ALL ON SCHEMA public TO test_non_member_runner;
    `);

    const nonMemberPool = new pg.Pool({
      connectionString: `postgresql://test_non_member_runner:non_member_pass@${host}:${port}/${dbName}`,
      max: 1
    });

    try {
      await nonMemberPool.query(`
        CREATE OR REPLACE FUNCTION test_runner_non_member_fn()
        RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;
      `);

      await assert.rejects(
        () => nonMemberPool.query('ALTER FUNCTION test_runner_non_member_fn() OWNER TO operza_auth_definer;'),
        /must be (able to SET ROLE|member of role|a member of role) "operza_auth_definer"/i,
        'PostgreSQL must reject ALTER FUNCTION OWNER TO when executing user is not a member of target role'
      );
    } finally {
      await nonMemberPool.end();
      await superuserPool.query(`
        DROP FUNCTION IF EXISTS test_runner_non_member_fn();
        REVOKE ALL ON SCHEMA public FROM test_non_member_runner;
        DROP OWNED BY test_non_member_runner;
        DROP ROLE IF EXISTS test_non_member_runner;
      `);
    }
  });

  await t.test('13. Negative Case: Failed migration rolls back cleanly without marking as applied', async () => {
    // 13a. Baseline assertion: Demonstrate that a valid migration transaction commits normally
    const commitClient = await migratorPool.connect();
    const testSuccessTable = 'success_migration_transact_test';
    const testSuccessMigration = '998_successful_migration_test.sql';
    try {
      await commitClient.query('BEGIN');
      await commitClient.query(`CREATE TABLE ${testSuccessTable} (id int);`);
      await commitClient.query('INSERT INTO schema_migrations (name) VALUES ($1);', [testSuccessMigration]);
      await commitClient.query('COMMIT');
    } catch (err) {
      await commitClient.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      commitClient.release();
    }

    // Verify baseline transaction committed and persisted data
    const successTblCheck = await migratorPool.query('SELECT 1 FROM information_schema.tables WHERE table_name = $1;', [testSuccessTable]);
    assert.equal(successTblCheck.rowCount, 1, 'Table created in successful transaction must persist');
    const successMigCheck = await migratorPool.query('SELECT 1 FROM schema_migrations WHERE name = $1;', [testSuccessMigration]);
    assert.equal(successMigCheck.rowCount, 1, 'Migration record created in successful transaction must persist');

    // Clean up baseline fixtures
    await migratorPool.query(`DROP TABLE IF EXISTS ${testSuccessTable};`);
    await migratorPool.query('DELETE FROM schema_migrations WHERE name = $1;', [testSuccessMigration]);

    // 13b. Failed transaction rolls back on intentional division-by-zero (SQLSTATE 22012)
    const client = await migratorPool.connect();
    const testFailTable = 'failed_migration_transact_test';
    const testMigrationName = '999_failing_migration_test.sql';
    let divisionError = null;

    try {
      await client.query('BEGIN');
      await client.query(`CREATE TABLE ${testFailTable} (id int);`);

      // Trigger intentional division by zero
      try {
        await client.query('SELECT 1/0;');
        assert.fail('SELECT 1/0 must throw an error');
      } catch (err) {
        divisionError = err;
        // Assert exact SQLSTATE 22012 (division_by_zero)
        assert.equal(err.code, '22012', `Expected SQLSTATE 22012 (division_by_zero), got ${err.code}: ${err.message}`);
        assert.match(err.message, /division by zero/i);
        // Re-throw to trigger rollback path
        throw err;
      }

      await client.query('INSERT INTO schema_migrations (name) VALUES ($1);', [testMigrationName]);
      await client.query('COMMIT');
      assert.fail('Should not reach here on 1/0');
    } catch (err) {
      assert.strictEqual(err, divisionError, 'Caught error in rollback handler must be the intentional division-by-zero error');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    assert.ok(divisionError, 'Division-by-zero error must have been triggered and verified');

    // Verify table does NOT exist
    const tblCheck = await migratorPool.query('SELECT 1 FROM information_schema.tables WHERE table_name = $1;', [testFailTable]);
    assert.equal(tblCheck.rowCount, 0, 'Table created inside failed transaction must not exist');

    // Verify migration was NOT marked as applied
    const migCheck = await migratorPool.query('SELECT 1 FROM schema_migrations WHERE name = $1;', [testMigrationName]);
    assert.equal(migCheck.rowCount, 0, 'Failed migration must not be recorded in schema_migrations');
  });
});
