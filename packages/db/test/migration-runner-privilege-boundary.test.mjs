import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatedTestPostgres } from '../lib/test-postgres-server.mjs';
import {
  runPrivilegedBootstrap,
  runUnprivilegedMigrations,
  runMigrationPipeline,
  verifyRolesAndAttributes,
  DEFAULT_MIGRATOR_PASSWORD
} from '../scripts/migrate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

test('Phase 20.2.5.6: Production Migration Pipeline Execution, Bootstrap Privilege & Error Integrity', async (t) => {
  // 1. Provision fresh isolated PostgreSQL database
  const pgServer = new IsolatedTestPostgres({ port: 5436, dbName: 'operza_prod_migrator_test' });
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

  // STEP 2: Perform Stage A (Privileged Bootstrap) using administrative superuser connection
  await t.test('1. Stage A: Run privileged bootstrap via production runPrivilegedBootstrap()', async () => {
    await runPrivilegedBootstrap(superuserPool, {
      migratorPassword
    });

    // Verify all roles and attributes fail closed
    await verifyRolesAndAttributes(superuserPool);
  });

  // STEP 3: Configure actual unprivileged operza_migrator connection
  await t.test('2. Stage B Identity: Connect as operza_migrator and assert current_user', async () => {
    migratorPool = new pg.Pool({ connectionString: migratorDbUrl, max: 5 });
    t.after(async () => {
      if (migratorPool) await migratorPool.end();
    });

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
    const client = await migratorPool.connect();
    const testFailTable = 'failed_migration_transact_test';
    const testMigrationName = '999_failing_migration_test.sql';

    try {
      await client.query('BEGIN');
      await client.query(`CREATE TABLE ${testFailTable} (id int);`);
      // Trigger intentional division by zero
      await client.query('SELECT 1/0;');
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1);', [testMigrationName]);
      await client.query('COMMIT');
      assert.fail('Should not reach here on 1/0');
    } catch (err) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // Verify table does not exist
    const tblCheck = await migratorPool.query('SELECT 1 FROM information_schema.tables WHERE table_name = $1;', [testFailTable]);
    assert.equal(tblCheck.rowCount, 0, 'Table created inside failed transaction must not exist');

    // Verify migration was NOT marked as applied
    const migCheck = await migratorPool.query('SELECT 1 FROM schema_migrations WHERE name = $1;', [testMigrationName]);
    assert.equal(migCheck.rowCount, 0, 'Failed migration must not be recorded in schema_migrations');
  });
});
