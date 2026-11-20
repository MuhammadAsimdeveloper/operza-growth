import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto, { randomUUID } from 'node:crypto';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const migrationsDir = path.join(root, 'migrations');

/**
 * Validates that a connection URL is strictly targeted at an isolated test database.
 * Throws immediately if URL points to a production or non-test database.
 */
export function assertSafeTestDatabaseUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('DATABASE_SAFETY_VIOLATION: Database URL must be a non-empty string');
  }
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();

  // Explicit safety check: Must contain 'test' or end with '_test'
  const isExplicitTestDb = dbName.includes('test') || dbName.endsWith('_test') || dbName.startsWith('test_');
  const isDangerousProdName = /^(operza|operza_db|operza_prod|production|prod|master|main|postgres)$/i.test(dbName);

  if (!isExplicitTestDb || isDangerousProdName) {
    throw new Error(`DATABASE_SAFETY_VIOLATION: Refusing to run integration test on non-test database: "${dbName}". Target database must contain "test" in name.`);
  }

  return true;
}

test('PostgreSQL Safety Guard: rejects non-test and production database URLs', () => {
  // Should reject production or ambiguous names
  assert.throws(
    () => assertSafeTestDatabaseUrl('postgresql://operza_app:secret@localhost:5432/operza_db'),
    /DATABASE_SAFETY_VIOLATION/
  );
  assert.throws(
    () => assertSafeTestDatabaseUrl('postgresql://operza_app:secret@localhost:5432/operza_prod'),
    /DATABASE_SAFETY_VIOLATION/
  );
  assert.throws(
    () => assertSafeTestDatabaseUrl('postgresql://postgres:secret@localhost:5432/postgres'),
    /DATABASE_SAFETY_VIOLATION/
  );
  assert.throws(
    () => assertSafeTestDatabaseUrl('postgresql://postgres:secret@localhost:5432/production'),
    /DATABASE_SAFETY_VIOLATION/
  );

  // Should accept valid test database names
  assert.equal(assertSafeTestDatabaseUrl('postgresql://operza_test:secret@localhost:5432/operza_test'), true);
  assert.equal(assertSafeTestDatabaseUrl('postgresql://runner:secret@127.0.0.1:5432/operza_ci_test'), true);
  assert.equal(assertSafeTestDatabaseUrl('postgresql://postgres:postgres@localhost:5432/test_db'), true);
});

test('Migrations Inventory: all 27 migrations exist in sequential order', async () => {
  const files = (await readdir(migrationsDir))
    .filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort();

  assert.equal(files.length >= 27, true, `Expected at least 27 migrations, found ${files.length}`);
  
  // Verify sequential numbering 001 through 027
  for (let i = 1; i <= 27; i++) {
    const prefix = String(i).padStart(3, '0');
    const matched = files.find(f => f.startsWith(`${prefix}_`));
    assert.ok(matched, `Missing migration with prefix ${prefix}_`);
  }
});

test('Real PostgreSQL Integration Harness & RLS Enforcement', async (t) => {
  const testDbUrl = process.env.OPERZA_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

  if (!testDbUrl) {
    if (process.env.REQUIRE_POSTGRES_INTEGRATION === 'true' || process.env.CI) {
      throw new Error('CI_FAILURE: OPERZA_TEST_DATABASE_URL is strictly required for PostgreSQL integration in CI environment.');
    }
    t.skip(
      'UNVERIFIED LOCALLY / PENDING STAGING CI: OPERZA_TEST_DATABASE_URL is not configured. ' +
      'In CI (and staging runners), this integration suite executes against a real postgres:16 service container.'
    );
    return;
  }

  // Safety guard execution
  assertSafeTestDatabaseUrl(testDbUrl);

  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: testDbUrl,
    max: 5,
    connectionTimeoutMillis: 5000
  });

  try {
    // Probe connection
    await pool.query('SELECT 1');
    console.log('[REAL-PG-TEST] Connected to real PostgreSQL at:', testDbUrl.replace(/:[^:@]+@/, ':***@'));
  } catch (err) {
    await pool.end();
    if (process.env.REQUIRE_POSTGRES_INTEGRATION === 'true' || process.env.CI) {
      throw new Error(`CI_FAILURE: Could not connect to real PostgreSQL at ${testDbUrl} in CI: ${err.message}`);
    }
    t.skip(
      `UNVERIFIED LOCALLY / PENDING STAGING CI: Could not connect to real PostgreSQL at ${testDbUrl} (${err.message}). ` +
      'CI service container will run full real-postgres-integration suite.'
    );
    return;
  }

  try {
    // 0. Ensure least-privilege roles exist in test container with valid security properties
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS btree_gist;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_auth_definer') THEN
          CREATE ROLE operza_auth_definer NOLOGIN NOINHERIT BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_app') THEN
          CREATE ROLE operza_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_worker') THEN
          CREATE ROLE operza_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
      END $$;
      DO $$ BEGIN
        EXECUTE format('GRANT operza_auth_definer TO %I', current_user);
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
      GRANT USAGE, CREATE ON SCHEMA public TO operza_auth_definer;
    `);

    // 1. Create schema_migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // 2. Run all migrations 001 through 027 in deterministic sequence
    const files = (await readdir(migrationsDir))
      .filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
      .sort();

    for (const file of files) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
        if (!applied.rowCount) {
          const sql = await readFile(path.join(migrationsDir, file), 'utf8');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file} failed: ${e.message}`);
      } finally {
        client.release();
      }
    }

    // 3. Verify RLS tables have FORCE ROW LEVEL SECURITY enabled
    const rlsCheck = await pool.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN (
        'agencies', 'locations', 'users', 'agency_memberships', 'contacts',
        'opportunities', 'calendars', 'appointments', 'workflow_definitions',
        'workflow_executions', 'workflow_execution_steps', 'billing_ledger_accounts',
        'immutable_audit_events'
      )
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    `);

    assert.ok(rlsCheck.rows.length >= 10, 'Expected core RLS tables to exist');
    for (const row of rlsCheck.rows) {
      assert.equal(row.relrowsecurity, true, `Table ${row.relname} must have ROW LEVEL SECURITY enabled`);
      assert.equal(row.relforcerowsecurity, true, `Table ${row.relname} must have FORCE ROW LEVEL SECURITY enabled`);
    }

    // 4. Verify role attributes: operza_app and operza_worker must be NOSUPERUSER and NOBYPASSRLS
    const roleCheck = await pool.query(`
      SELECT rolname, rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname IN ('operza_app', 'operza_worker')
    `);
    for (const row of roleCheck.rows) {
      assert.equal(row.rolsuper, false, `Role ${row.rolname} must not be superuser`);
      assert.equal(row.rolbypassrls, false, `Role ${row.rolname} must not have BYPASSRLS`);
    }

    // 5. Test RLS Tenant Isolation under operza_app role
    const clientA = await pool.connect();
    const clientB = await pool.connect();

    const agencyA = randomUUID();
    const locA1 = randomUUID();
    const locA2 = randomUUID();
    const userA = randomUUID();

    const agencyB = randomUUID();
    const locB1 = randomUUID();
    const userB = randomUUID();

    try {

      // Seed baseline agencies and locations using administrative connection
      await pool.query(`
        INSERT INTO agencies (id, name, slug) VALUES 
          ($1, 'Tenant A Inc', 'tenant-a-${Date.now()}'),
          ($2, 'Tenant B Inc', 'tenant-b-${Date.now()}')
        ON CONFLICT (id) DO NOTHING
      `, [agencyA, agencyB]);

      await pool.query(`
        INSERT INTO locations (id, agency_id, name) VALUES 
          ($1, $2, 'Location A1'),
          ($3, $2, 'Location A2'),
          ($4, $5, 'Location B1')
        ON CONFLICT (agency_id, id) DO NOTHING
      `, [locA1, agencyA, locA2, locB1, agencyB]);

      // Seed workflow definition for Tenant A
      const workflowId = randomUUID();
      await pool.query(`
        INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, version)
        VALUES ($1, $2, $3, 'Live CI Flow', 'published', 'manual', 1)
      `, [workflowId, agencyA, locA1]);

      // Switch both test clients to the genuine least-privileged application role
      await clientA.query('SET ROLE operza_app');
      await clientB.query('SET ROLE operza_app');

      // 5a. Opportunity RLS Isolation
      await clientA.query('BEGIN');
      await clientA.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)", [agencyA, locA1, userA]);

      const oppIdA = randomUUID();
      const pipeIdA = randomUUID();
      const stageIdA = randomUUID();
      await clientA.query(`
        INSERT INTO opportunities (id, agency_id, location_id, pipeline_id, stage_id, name, status, value)
        VALUES ($1, $2, $3, $4, $5, 'Enterprise Deal A', 'open', 50000)
        ON CONFLICT (agency_id, location_id, id) DO NOTHING
      `, [oppIdA, agencyA, locA1, pipeIdA, stageIdA]);

      // Tenant A sees its record
      const checkA = await clientA.query('SELECT * FROM opportunities WHERE id = $1', [oppIdA]);
      assert.equal(checkA.rowCount, 1, 'Tenant A must see its own opportunity');

      // Tenant B Context
      await clientB.query('BEGIN');
      await clientB.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)", [agencyB, locB1, userB]);

      // Tenant B queries for Tenant A's record -> MUST RETURN 0 ROWS
      const checkB = await clientB.query('SELECT * FROM opportunities WHERE id = $1', [oppIdA]);
      assert.equal(checkB.rowCount, 0, 'Tenant B must receive 0 rows when querying Tenant A record (RLS isolation)');

      // 5b. Workflow Executions RLS & Isolation
      const execId = randomUUID();
      await clientA.query(`
        INSERT INTO workflow_executions (
          id, agency_id, location_id, workflow_id, status, attempts, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'running', 0, now(), now())
      `, [execId, agencyA, locA1, workflowId]);

      // Tenant B queries for execution -> 0 rows
      const execCheckB = await clientB.query('SELECT * FROM workflow_executions WHERE id = $1', [execId]);
      assert.equal(execCheckB.rowCount, 0, 'Tenant B must not see Tenant A workflow execution');

      // Cross-tenant update from Tenant B -> affects 0 rows
      const crossUpdateB = await clientB.query(`
        UPDATE workflow_executions SET status = 'completed'
        WHERE agency_id = $1 AND location_id = $2 AND id = $3
      `, [agencyB, locB1, execId]);
      assert.equal(crossUpdateB.rowCount, 0, 'Cross-tenant execution update must affect 0 rows');

      // Same-agency cross-location isolation: Tenant A under locA2 context
      await clientB.query('COMMIT');
      await clientB.query('BEGIN');
      await clientB.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [agencyA, locA2]);
      const crossLocCheck = await clientB.query('SELECT * FROM workflow_executions WHERE id = $1', [execId]);
      assert.equal(crossLocCheck.rowCount, 0, 'Same-agency cross-location query must return 0 rows');

      // Legitimate Tenant A update
      const validUpdate = await clientA.query(`
        UPDATE workflow_executions SET status = 'completed', updated_at = now()
        WHERE agency_id = $1 AND location_id = $2 AND id = $3
      `, [agencyA, locA1, execId]);
      assert.equal(validUpdate.rowCount, 1, 'Legitimate tenant update must affect exactly 1 row');

      await clientA.query('COMMIT');
      await clientB.query('ROLLBACK');
    } finally {
      await clientA.query('RESET ROLE').catch(() => {});
      await clientB.query('RESET ROLE').catch(() => {});
      clientA.release();
      clientB.release();
    }

    // 6. Test Audit Trail Immutability (Migration 014)
    const auditClient = await pool.connect();
    try {
      await auditClient.query('BEGIN');
      const testAgency = agencyA;
      const testLoc = locA1;
      const eventId = randomUUID();

      await auditClient.query(`
        INSERT INTO immutable_audit_events (id, agency_id, location_id, actor_id, actor_type, event_name, event_hash)
        VALUES ($1, $2, $3, 'system', 'system_cron', 'security.test_event', 'hash_test_123')
      `, [eventId, testAgency, testLoc]);

      // Attempting to UPDATE audit event must be BLOCKED by rule (DO INSTEAD NOTHING)
      const updateRes = await auditClient.query("UPDATE immutable_audit_events SET event_name = 'tampered' WHERE id = $1", [eventId]);
      assert.equal(updateRes.rowCount, 0, 'Audit log UPDATE must affect 0 rows due to immutability rule');

      // Row still has original event_name
      const auditRow = await auditClient.query("SELECT event_name FROM immutable_audit_events WHERE id = $1", [eventId]);
      assert.equal(auditRow.rows[0].event_name, 'security.test_event', 'Audit event data must be unchanged');

      // Attempting to DELETE audit event must be BLOCKED by rule (DO INSTEAD NOTHING)
      const deleteRes = await auditClient.query("DELETE FROM immutable_audit_events WHERE id = $1", [eventId]);
      assert.equal(deleteRes.rowCount, 0, 'Audit log DELETE must affect 0 rows due to immutability rule');

      await auditClient.query('COMMIT');
    } finally {
      auditClient.release();
    }

    console.log('[REAL-PG-TEST] All real PostgreSQL RLS and least-privilege checks passed successfully.');
  } finally {
    await pool.end();
  }
});
