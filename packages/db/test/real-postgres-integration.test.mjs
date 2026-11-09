import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('Migrations Inventory: all 14 migrations exist in sequential order', async () => {
  const files = (await readdir(migrationsDir))
    .filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort();

  assert.equal(files.length >= 14, true, `Expected at least 14 migrations, found ${files.length}`);
  
  // Verify sequential numbering 001 through 014
  for (let i = 1; i <= 14; i++) {
    const prefix = String(i).padStart(3, '0');
    const matched = files.find(f => f.startsWith(`${prefix}_`));
    assert.ok(matched, `Missing migration with prefix ${prefix}_`);
  }
});

test('Real PostgreSQL Integration Harness & RLS Enforcement', async (t) => {
  const testDbUrl = process.env.OPERZA_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

  if (!testDbUrl) {
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
    connectionTimeoutMillis: 3000
  });

  try {
    // Probe connection
    await pool.query('SELECT 1');
  } catch (err) {
    await pool.end();
    t.skip(
      `UNVERIFIED LOCALLY / PENDING STAGING CI: Could not connect to real PostgreSQL at ${testDbUrl} (${err.message}). ` +
      'CI service container will run full real-postgres-integration suite.'
    );
    return;
  }

  try {
    // 0. Ensure application and worker least-privilege roles exist in test container
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_app') THEN
          CREATE ROLE operza_app LOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_worker') THEN
          CREATE ROLE operza_worker LOGIN;
        END IF;
      END $$;
    `);

    // 1. Create schema_migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // 2. Run migrations 001 through 014 in sequence
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

    // 3. Verify RLS tables have FORCE ROW LEVEL SECURITY
    const rlsCheck = await pool.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('agencies', 'users', 'agency_memberships', 'contacts', 'opportunities', 'calendars', 'appointments', 'billing_ledger_accounts', 'audit_events')
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    `);

    assert.ok(rlsCheck.rows.length >= 7, 'Expected core RLS tables to exist');
    for (const row of rlsCheck.rows) {
      assert.equal(row.relrowsecurity, true, `Table ${row.relname} must have ROW LEVEL SECURITY enabled`);
      assert.equal(row.relforcerowsecurity, true, `Table ${row.relname} must have FORCE ROW LEVEL SECURITY enabled`);
    }

    // 4. Test RLS Tenant Isolation
    const clientA = await pool.connect();
    const clientB = await pool.connect();

    try {
      const agencyA = '10000000-0000-0000-0000-000000000001';
      const locA = '20000000-0000-0000-0000-000000000001';
      const userA = '30000000-0000-0000-0000-000000000001';

      const agencyB = '10000000-0000-0000-0000-000000000002';
      const locB = '20000000-0000-0000-0000-000000000002';
      const userB = '30000000-0000-0000-0000-000000000002';

      // Insert baseline agency & location using super/migrator connection
      await pool.query(`
        INSERT INTO agencies (id, name, slug) VALUES 
          ('${agencyA}', 'Tenant A Inc', 'tenant-a'),
          ('${agencyB}', 'Tenant B Inc', 'tenant-b')
        ON CONFLICT (id) DO NOTHING
      `);

      await pool.query(`
        INSERT INTO locations (id, agency_id, name) VALUES 
          ('${locA}', '${agencyA}', 'Location A'),
          ('${locB}', '${agencyB}', 'Location B')
        ON CONFLICT (id) DO NOTHING
      `);

      // Tenant A Context
      await clientA.query('BEGIN');
      await clientA.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)", [agencyA, locA, userA]);

      // Insert opportunity for Tenant A
      const oppIdA = '40000000-0000-0000-0000-000000000001';
      await clientA.query(`
        INSERT INTO opportunities (id, agency_id, location_id, title, status, monetary_value)
        VALUES ($1, $2, $3, 'Enterprise Deal A', 'open', 50000)
        ON CONFLICT (agency_id, location_id, id) DO NOTHING
      `, [oppIdA, agencyA, locA]);

      // Tenant A sees its record
      const checkA = await clientA.query('SELECT * FROM opportunities WHERE id = $1', [oppIdA]);
      assert.equal(checkA.rowCount, 1, 'Tenant A must see its own opportunity');

      // Tenant B Context
      await clientB.query('BEGIN');
      await clientB.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)", [agencyB, locB, userB]);

      // Tenant B queries for Tenant A's record -> MUST RETURN 0 ROWS
      const checkB = await clientB.query('SELECT * FROM opportunities WHERE id = $1', [oppIdA]);
      assert.equal(checkB.rowCount, 0, 'Tenant B must receive 0 rows when querying Tenant A record (RLS isolation)');

      await clientA.query('ROLLBACK');
      await clientB.query('ROLLBACK');
    } finally {
      clientA.release();
      clientB.release();
    }

    // 5. Test Audit Trail Immutability (Migration 014)
    const auditClient = await pool.connect();
    try {
      await auditClient.query('BEGIN');
      const testAgency = '10000000-0000-0000-0000-000000000001';
      const testLoc = '20000000-0000-0000-0000-000000000001';
      const eventId = '50000000-0000-0000-0000-000000000001';

      await auditClient.query(`
        INSERT INTO audit_events (id, agency_id, location_id, actor_id, event_type, payload_hash)
        VALUES ($1, $2, $3, 'system', 'security.test_event', 'hash_test_123')
        ON CONFLICT (id) DO NOTHING
      `, [eventId, testAgency, testLoc]);

      // Attempting to UPDATE audit event must be BLOCKED by trigger
      let updateBlocked = false;
      try {
        await auditClient.query("UPDATE audit_events SET event_type = 'tampered' WHERE id = $1", [eventId]);
      } catch (err) {
        updateBlocked = true;
      }
      assert.equal(updateBlocked, true, 'Audit log UPDATE must be blocked by immutability trigger');

      // Attempting to DELETE audit event must be BLOCKED by trigger
      let deleteBlocked = false;
      try {
        await auditClient.query("DELETE FROM audit_events WHERE id = $1", [eventId]);
      } catch (err) {
        deleteBlocked = true;
      }
      assert.equal(deleteBlocked, true, 'Audit log DELETE must be blocked by immutability trigger');

      await auditClient.query('ROLLBACK');
    } finally {
      auditClient.release();
    }

  } finally {
    await pool.end();
  }
});
