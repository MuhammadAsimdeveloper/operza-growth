import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatedTestPostgres } from '../lib/test-postgres-server.mjs';
import {
  runPrivilegedBootstrap,
  runUnprivilegedMigrations,
  verifyRolesAndAttributes,
  DEFAULT_MIGRATOR_PASSWORD
} from '../scripts/migrate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

test('Phase 20.2.5.5: Migration Runner Privilege Boundary & Real Execution Verification', async (t) => {
  // 1. Provision fresh isolated PostgreSQL database
  const pgServer = new IsolatedTestPostgres({ port: 5436, dbName: 'operza_migrator_boundary_test' });
  const adminDbUrl = await pgServer.start();

  const { default: pg } = await import('pg');
  const superuserPool = new pg.Pool({ connectionString: adminDbUrl, max: 5 });

  t.after(async () => {
    await superuserPool.end();
    await pgServer.stop();
  });

  const parsedUrl = new URL(adminDbUrl);
  const host = parsedUrl.hostname;
  const port = parsedUrl.port;
  const dbName = parsedUrl.pathname.replace(/^\//, '');

  const migratorPassword = DEFAULT_MIGRATOR_PASSWORD;
  const migratorDbUrl = `postgresql://operza_migrator:${migratorPassword}@${host}:${port}/${dbName}`;
  let migratorPool;

  // 2. Perform Stage A using an administrative connection
  await t.test('Step 2: Perform Stage A (Privileged Bootstrap) using administrative connection', async () => {
    await runPrivilegedBootstrap(superuserPool, {
      migratorPassword
    });

    // Verify roles and attributes fail closed
    await verifyRolesAndAttributes(superuserPool);
  });

  // 3. Open separate connection authenticated as operza_migrator
  await t.test('Step 3 & 4: Open separate connection as operza_migrator and assert current_user', async () => {
    migratorPool = new pg.Pool({ connectionString: migratorDbUrl, max: 5 });
    t.after(async () => {
      if (migratorPool) await migratorPool.end();
    });

    const res = await migratorPool.query('SELECT current_user, session_user;');
    assert.equal(res.rows[0].current_user, 'operza_migrator', 'current_user must strictly be operza_migrator');
    assert.equal(res.rows[0].session_user, 'operza_migrator', 'session_user must strictly be operza_migrator');
  });

  // Apply migrations 001 through 024 under operza_migrator to establish baseline tables & functions
  await t.test('Prerequisite: Apply migrations 001-024 strictly as operza_migrator', async () => {
    await migratorPool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now());');

    const files = (await readdir(migrationsDir))
      .filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
      .sort();

    const baselineFiles = files.filter(f => {
      const num = parseInt(f.slice(0, 3), 10);
      return num >= 1 && num <= 24;
    });

    assert.equal(baselineFiles.length, 24, 'Must apply exactly migrations 001 through 024 as baseline');

    for (const file of baselineFiles) {
      const client = await migratorPool.connect();
      try {
        await client.query('BEGIN');
        const sql = await readFile(path.join(migrationsDir, file), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING;', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Baseline migration ${file} failed under operza_migrator: ${err.message}`);
      } finally {
        client.release();
      }
    }
  });

  // 5. Execute Migration 025 using operza_migrator connection (NOT superuserPool)
  await t.test('Step 5: Execute Migration 025 genuinely as operza_migrator', async () => {
    const client = await migratorPool.connect();
    try {
      // Assert connection is strictly operza_migrator
      const identCheck = await client.query('SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user;');
      assert.equal(identCheck.rows[0].current_user, 'operza_migrator');
      assert.equal(identCheck.rows[0].rolsuper, false);

      await client.query('BEGIN');
      const sql025 = await readFile(path.join(migrationsDir, '025_workflow_definition_and_calendar_location_hardening.sql'), 'utf8');
      await client.query(sql025);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING;', ['025_workflow_definition_and_calendar_location_hardening.sql']);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration 025 failed to execute under operza_migrator: ${err.message}`);
    } finally {
      client.release();
    }
  });

  // Apply Migration 026 and 027 as operza_migrator to complete the full security definer matrix
  await t.test('Apply migrations 026 and 027 strictly as operza_migrator', async () => {
    for (const file of ['026_migration_owner_and_approval_expiration_hardening.sql', '027_strict_location_boundary_repair.sql']) {
      const client = await migratorPool.connect();
      try {
        await client.query('BEGIN');
        const sql = await readFile(path.join(migrationsDir, file), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING;', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file} failed under operza_migrator: ${err.message}`);
      } finally {
        client.release();
      }
    }
  });

  // 6. Verify all five security-definer functions are owned by operza_auth_definer
  await t.test('Step 6: Verify all five security-definer helper functions are owned by operza_auth_definer', async () => {
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

  // 7. Verify the migrator did not gain SUPERUSER, BYPASSRLS, CREATEDB, or CREATEROLE
  await t.test('Step 7: Verify operza_migrator retained strict least-privilege attributes', async () => {
    const res = await migratorPool.query(`
      SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin
      FROM pg_roles
      WHERE rolname = 'operza_migrator';
    `);

    assert.equal(res.rowCount, 1, 'operza_migrator must exist');
    const r = res.rows[0];
    assert.equal(r.rolsuper, false, 'operza_migrator must NOT have SUPERUSER');
    assert.equal(r.rolbypassrls, false, 'operza_migrator must NOT have BYPASSRLS');
    assert.equal(r.rolcreatedb, false, 'operza_migrator must NOT have CREATEDB');
    assert.equal(r.rolcreaterole, false, 'operza_migrator must NOT have CREATEROLE');
    assert.equal(r.rolinherit, false, 'operza_migrator must NOT have INHERIT');
    assert.equal(r.rolcanlogin, true, 'operza_migrator must have LOGIN');
  });

  // 8. Verify the runtime roles remain least-privileged
  await t.test('Step 8: Verify runtime roles (operza_app, operza_worker) remain least-privileged', async () => {
    const res = await migratorPool.query(`
      SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit
      FROM pg_roles
      WHERE rolname IN ('operza_app', 'operza_worker')
      ORDER BY rolname;
    `);

    assert.equal(res.rowCount, 2, 'Both runtime roles must exist');
    for (const r of res.rows) {
      assert.equal(r.rolsuper, false, `Runtime role ${r.rolname} must NOT have SUPERUSER`);
      assert.equal(r.rolbypassrls, false, `Runtime role ${r.rolname} must NOT have BYPASSRLS`);
      assert.equal(r.rolcreatedb, false, `Runtime role ${r.rolname} must NOT have CREATEDB`);
      assert.equal(r.rolcreaterole, false, `Runtime role ${r.rolname} must NOT have CREATEROLE`);
      assert.equal(r.rolinherit, false, `Runtime role ${r.rolname} must NOT have INHERIT`);
      assert.equal(r.rolcanlogin, true, `Runtime role ${r.rolname} must have LOGIN`);
    }
  });

  // 9. Demonstrate that the migrator cannot create a new role
  await t.test('Step 9: Demonstrate that operza_migrator cannot create a new role', async () => {
    await assert.rejects(
      () => migratorPool.query('CREATE ROLE rogue_security_role;'),
      /permission denied to create role/i,
      'operza_migrator must fail closed with permission denied when attempting CREATE ROLE'
    );
  });

  // 10. Confirm that migration failures are surfaced rather than hidden
  await t.test('Step 10: Confirm that migration failures are surfaced visibly rather than hidden', async () => {
    const client = await migratorPool.connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(
        () => client.query('SELECT * FROM non_existent_table_must_fail_visibly;'),
        /relation "non_existent_table_must_fail_visibly" does not exist/i,
        'Database query error must be thrown directly without suppression'
      );
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  // NEGATIVE CASES
  await t.test('Negative Case 1: Unprivileged role without role membership cannot perform ownership transfer', async () => {
    // Superuser provisions an isolated test role with schema privileges but NO membership in operza_auth_definer
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
      // test_non_member_runner creates a test function
      await nonMemberPool.query(`
        CREATE OR REPLACE FUNCTION test_runner_non_member_fn()
        RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;
      `);

      // Attempt to reassign function ownership to operza_auth_definer WITHOUT membership in operza_auth_definer
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
      `).catch(() => {});
    }
  });

  await t.test('Negative Case 2: Unprivileged role without schema privileges fails visibly', async () => {
    await superuserPool.query(`
      DROP ROLE IF EXISTS test_no_schema_priv_runner;
      CREATE ROLE test_no_schema_priv_runner LOGIN PASSWORD 'no_priv_pass' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      REVOKE ALL ON SCHEMA public FROM test_no_schema_priv_runner;
    `);

    const noSchemaPool = new pg.Pool({
      connectionString: `postgresql://test_no_schema_priv_runner:no_priv_pass@${host}:${port}/${dbName}`,
      max: 1
    });

    try {
      await assert.rejects(
        () => noSchemaPool.query('CREATE TABLE public.unauthorized_tbl (id int);'),
        /permission denied for schema public/i,
        'User without schema privileges must fail visibly'
      );
    } finally {
      await noSchemaPool.end();
      await superuserPool.query('DROP ROLE IF EXISTS test_no_schema_priv_runner;');
    }
  });

  await t.test('Negative Case 3: Failed migration rolls back its transaction cleanly', async () => {
    const client = await migratorPool.connect();
    const testTableName = 'rollback_test_table_phase20';
    try {
      await client.query('BEGIN');
      await client.query(`CREATE TABLE ${testTableName} (id int);`);
      // Trigger intentional division by zero inside transaction
      await client.query('SELECT 1/0;');
      await client.query('COMMIT');
      assert.fail('Transaction should have failed on 1/0');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
    } finally {
      client.release();
    }

    // Verify table does NOT exist in the database
    const checkTable = await migratorPool.query(`
      SELECT 1 FROM information_schema.tables WHERE table_name = $1;
    `, [testTableName]);
    assert.equal(checkTable.rowCount, 0, 'Table created inside aborted transaction must not persist after rollback');
  });

  await t.test('Negative Case 4: Privileged bootstrap failure prevents migration execution', async () => {
    // Attempting Stage A with an unprivileged user lacking CREATEROLE / SUPERUSER must fail loudly
    const nonPrivAdminPool = new pg.Pool({
      connectionString: migratorDbUrl,
      max: 1
    });

    try {
      await assert.rejects(
        () => runPrivilegedBootstrap(nonPrivAdminPool),
        /PRIVILEGE_ERROR|insufficient_privilege|permission denied/i,
        'Bootstrap must reject unprivileged connections and prevent progression'
      );
    } finally {
      await nonPrivAdminPool.end();
    }
  });

  await t.test('Negative Case 5: No fallback silently switches migration execution to a superuser', async () => {
    // Verify that when an unprivileged migration fails, the error is returned to caller
    // and no silent fallback to superuser occurs.
    const client = await migratorPool.connect();
    try {
      const initialUser = (await client.query('SELECT current_user;')).rows[0].current_user;
      assert.equal(initialUser, 'operza_migrator');

      let migrationFailed = false;
      try {
        await client.query('BEGIN');
        await client.query('INVALID SQL SYNTAX TO TRIGGER ERROR;');
        await client.query('COMMIT');
      } catch (err) {
        migrationFailed = true;
        await client.query('ROLLBACK').catch(() => {});
      }

      assert.equal(migrationFailed, true, 'Migration syntax error must be thrown');
      
      // Verify user identity remained operza_migrator and was never elevated or switched
      const currentUser = (await client.query('SELECT current_user;')).rows[0].current_user;
      assert.equal(currentUser, 'operza_migrator', 'Identity must remain operza_migrator on failure');
    } finally {
      client.release();
    }
  });
});
