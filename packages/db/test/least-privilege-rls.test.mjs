import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto, { randomUUID } from 'node:crypto';
import { IsolatedTestPostgres } from '../lib/test-postgres-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

test('P0 Multi-Tenant Security & Database Least-Privilege RLS Verification', async (t) => {
  const pgServer = new IsolatedTestPostgres({ port: 5437, dbName: 'operza_rls_test' });
  const dbUrl = await pgServer.start();

  const { default: pg } = await import('pg');
  const superuserPool = new pg.Pool({ connectionString: dbUrl, max: 5 });

  t.after(async () => {
    await superuserPool.end();
    await pgServer.stop();
  });

  const parsedUrl = new URL(dbUrl);
  const host = parsedUrl.hostname;
  const port = parsedUrl.port;
  const dbName = parsedUrl.pathname.replace(/^\//, '');

  const appPassword = 'app_secure_password_test_123';
  const workerPassword = 'worker_secure_password_test_123';
  const migratorPassword = 'migrator_secure_password_test_123';

  // 1. Provision least-privilege roles with NOBYPASSRLS
  await t.test('1. Provision least-privilege roles (NOBYPASSRLS, NOSUPERUSER)', async () => {
    await superuserPool.query(`
      CREATE EXTENSION IF NOT EXISTS btree_gist;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_auth_definer') THEN
          CREATE ROLE operza_auth_definer NOLOGIN NOINHERIT BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_migrator') THEN
          CREATE ROLE operza_migrator LOGIN PASSWORD '${migratorPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_app') THEN
          CREATE ROLE operza_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_worker') THEN
          CREATE ROLE operza_worker LOGIN PASSWORD '${workerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
      END $$;

      GRANT ALL ON DATABASE "${dbName}" TO operza_migrator;
      GRANT CONNECT ON DATABASE "${dbName}" TO operza_app, operza_worker;
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

    // Verify role attributes fail closed
    const roleRes = await superuserPool.query(`
      SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit
      FROM pg_roles
      WHERE rolname IN ('operza_app', 'operza_worker', 'operza_migrator', 'operza_auth_definer')
      ORDER BY rolname
    `);

    assert.equal(roleRes.rowCount, 4, 'All four security roles (operza_app, operza_worker, operza_migrator, operza_auth_definer) must exist');
    const roleMap = new Map(roleRes.rows.map(r => [r.rolname, r]));
    for (const expectedRole of ['operza_app', 'operza_worker', 'operza_migrator', 'operza_auth_definer']) {
      assert.ok(roleMap.has(expectedRole), `Role "${expectedRole}" must exist in pg_roles`);
    }

    for (const [name, row] of roleMap.entries()) {
      assert.equal(row.rolsuper, false, `Role ${name} must NOT be a superuser`);
      assert.equal(row.rolcreatedb, false, `Role ${name} must NOT have CREATEDB`);
      assert.equal(row.rolcreaterole, false, `Role ${name} must NOT have CREATEROLE`);
      assert.equal(row.rolinherit, false, `Role ${name} must have NOINHERIT`);

      if (name === 'operza_auth_definer') {
        assert.equal(row.rolbypassrls, true, 'operza_auth_definer must have BYPASSRLS');
        assert.equal(row.rolcanlogin, false, 'operza_auth_definer must have NOLOGIN');
      } else {
        assert.equal(row.rolbypassrls, false, `Role ${name} must NOT have BYPASSRLS`);
        assert.equal(row.rolcanlogin, true, `Role ${name} must have LOGIN permission`);
      }
    }
  });

  // Migrator pool connecting as operza_migrator (unprivileged, NOSUPERUSER, NOBYPASSRLS)
  const migratorPool = new pg.Pool({
    connectionString: `postgresql://operza_migrator:${migratorPassword}@${host}:${port}/${dbName}`,
    max: 5
  });

  t.after(async () => {
    await migratorPool.end();
  });

  // 2. Apply all migrations sequentially (001 through 027) using unprivileged operza_migrator
  await t.test('2. Execute full migration suite (001 through 027) as operza_migrator', async () => {
    // Negative test: verify operza_migrator cannot create roles (NOCREATEROLE)
    await assert.rejects(
      () => migratorPool.query('CREATE ROLE unauthorized_test_role;'),
      /permission denied to create role/i,
      'operza_migrator must not have CREATEROLE'
    );

    const files = (await readdir(migrationsDir))
      .filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
      .sort();

    assert.ok(files.length >= 27, `Expected at least 27 migrations, found ${files.length}`);

    await migratorPool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now());');

    for (const file of files) {
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

  // 3. Verify FORCE ROW LEVEL SECURITY on all critical tenant tables
  await t.test('3. Verify Row-Level Security is ENABLED and FORCED on all tenant tables', async () => {
    const tables = [
      'agencies', 'users', 'agency_memberships', 'locations', 'location_records',
      'workflow_definitions', 'workflow_executions', 'workflow_execution_steps',
      'workflow_approvals', 'calendars', 'appointments', 'pipelines', 'pipeline_stages',
      'opportunities', 'communication_consents', 'provider_secrets', 'workflow_action_receipts'
    ];

    const rlsRes = await superuserPool.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])
    `, [tables]);

    const foundTables = new Set(rlsRes.rows.map(r => r.relname));
    for (const table of tables) {
      assert.ok(foundTables.has(table), `Table ${table} must exist in public schema`);
      const row = rlsRes.rows.find(r => r.relname === table);
      assert.equal(row.relrowsecurity, true, `Table ${table} must have RLS enabled (relrowsecurity)`);
      assert.equal(row.relforcerowsecurity, true, `Table ${table} must have FORCE RLS enabled (relforcerowsecurity)`);
    }
  });

  // Create isolated connections for operza_app and operza_worker
  const appPool = new pg.Pool({
    connectionString: `postgresql://operza_app:${appPassword}@${host}:${port}/${dbName}`,
    max: 5
  });
  const workerPool = new pg.Pool({
    connectionString: `postgresql://operza_worker:${workerPassword}@${host}:${port}/${dbName}`,
    max: 5
  });

  t.after(async () => {
    await appPool.end();
    await workerPool.end();
  });

  // Seed two distinct tenants using superuser pool
  const tenantA = randomUUID();
  const locationA1 = randomUUID();
  const locationA2 = randomUUID();
  const userA = randomUUID();
  const tokenA = crypto.randomBytes(32).toString('hex');
  const tokenHashA = crypto.createHash('sha256').update(tokenA).digest('hex');

  const tenantB = randomUUID();
  const locationB1 = randomUUID();
  const userB = randomUUID();
  const tokenB = crypto.randomBytes(32).toString('hex');
  const tokenHashB = crypto.createHash('sha256').update(tokenB).digest('hex');

  await t.test('4. Seed test fixtures across Tenant A and Tenant B', async () => {
    // Seed Tenant A
    await superuserPool.query('INSERT INTO agencies (id, name, slug) VALUES ($1, $2, $3)', [tenantA, 'Agency Alpha', 'agency-alpha']);
    await superuserPool.query('INSERT INTO locations (id, agency_id, name) VALUES ($1, $2, $3)', [locationA1, tenantA, 'Alpha HQ']);
    await superuserPool.query('INSERT INTO locations (id, agency_id, name) VALUES ($1, $2, $3)', [locationA2, tenantA, 'Alpha Branch']);
    await superuserPool.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)', [userA, 'Alice Alpha', 'alice@alpha.com', 'hashA']);
    await superuserPool.query('INSERT INTO agency_memberships (id, agency_id, user_id, role) VALUES ($1, $2, $3, $4)', [randomUUID(), tenantA, userA, 'owner']);
    await superuserPool.query('INSERT INTO auth_sessions (id, token_hash, csrf_hash, user_id, agency_id, expires_at) VALUES ($1, $2, $3, $4, $5, now() + interval \'1 day\')', [randomUUID(), tokenHashA, 'csrfA', userA, tenantA]);

    // Seed Tenant B
    await superuserPool.query('INSERT INTO agencies (id, name, slug) VALUES ($1, $2, $3)', [tenantB, 'Agency Beta', 'agency-beta']);
    await superuserPool.query('INSERT INTO locations (id, agency_id, name) VALUES ($1, $2, $3)', [locationB1, tenantB, 'Beta HQ']);
    await superuserPool.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)', [userB, 'Bob Beta', 'bob@beta.com', 'hashB']);
    await superuserPool.query('INSERT INTO agency_memberships (id, agency_id, user_id, role) VALUES ($1, $2, $3, $4)', [randomUUID(), tenantB, userB, 'owner']);
    await superuserPool.query('INSERT INTO auth_sessions (id, token_hash, csrf_hash, user_id, agency_id, expires_at) VALUES ($1, $2, $3, $4, $5, now() + interval \'1 day\')', [randomUUID(), tokenHashB, 'csrfB', userB, tenantB]);

    // Seed CRM and workflow records for Tenant A
    await superuserPool.query('INSERT INTO calendars (id, agency_id, location_id, name, slug, duration_min) VALUES ($1, $2, $3, $4, $5, $6)', [randomUUID(), tenantA, locationA1, 'Alpha Cal 1', 'alpha-cal-1', 30]);
    await superuserPool.query('INSERT INTO calendars (id, agency_id, location_id, name, slug, duration_min) VALUES ($1, $2, $3, $4, $5, $6)', [randomUUID(), tenantB, locationB1, 'Beta Cal 1', 'beta-cal-1', 30]);

    await superuserPool.query(`
      INSERT INTO appointments (id, agency_id, location_id, calendar_id, title, starts_at, ends_at, status)
      VALUES ($1, $2, $3, (SELECT id FROM calendars WHERE agency_id = $2 LIMIT 1), 'Alpha Meeting 1', '2026-12-01T10:00:00Z', '2026-12-01T10:30:00Z', 'confirmed')
    `, [randomUUID(), tenantA, locationA1]);

    await superuserPool.query(`
      INSERT INTO appointments (id, agency_id, location_id, calendar_id, title, starts_at, ends_at, status)
      VALUES ($1, $2, $3, (SELECT id FROM calendars WHERE agency_id = $2 LIMIT 1), 'Alpha Branch Meeting', '2026-12-01T11:00:00Z', '2026-12-01T11:30:00Z', 'confirmed')
    `, [randomUUID(), tenantA, locationA2]);

    await superuserPool.query(`
      INSERT INTO appointments (id, agency_id, location_id, calendar_id, title, starts_at, ends_at, status)
      VALUES ($1, $2, $3, (SELECT id FROM calendars WHERE agency_id = $2 LIMIT 1), 'Beta Meeting 1', '2026-12-01T10:00:00Z', '2026-12-01T10:30:00Z', 'confirmed')
    `, [randomUUID(), tenantB, locationB1]);
  });

  // 5. TEST: operza_app role least-privilege & fail-closed security
  await t.test('5. operza_app: Fails closed with zero rows when tenant context is missing', async () => {
    const client = await appPool.connect();
    try {
      // No set_config applied on this connection
      const agencies = await client.query('SELECT * FROM agencies');
      assert.equal(agencies.rows.length, 0, 'agencies must return 0 rows when tenant context is missing');

      const locations = await client.query('SELECT * FROM locations');
      assert.equal(locations.rows.length, 0, 'locations must return 0 rows when tenant context is missing');

      const users = await client.query('SELECT * FROM users');
      assert.equal(users.rows.length, 0, 'users must return 0 rows when tenant context is missing');

      const memberships = await client.query('SELECT * FROM agency_memberships');
      assert.equal(memberships.rows.length, 0, 'agency_memberships must return 0 rows when tenant context is missing');

      const calendars = await client.query('SELECT * FROM calendars');
      assert.equal(calendars.rows.length, 0, 'calendars must return 0 rows when tenant context is missing');

      const appointments = await client.query('SELECT * FROM appointments');
      assert.equal(appointments.rows.length, 0, 'appointments must return 0 rows when tenant context is missing');
    } finally {
      client.release();
    }
  });

  await t.test('6. operza_app: Strict isolation between Tenant A and Tenant B', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA1]);

      // 6.1 Tenant A sees only Tenant A agency
      const agencies = await client.query('SELECT * FROM agencies');
      assert.equal(agencies.rows.length, 1);
      assert.equal(agencies.rows[0].id, tenantA);

      // 6.2 Cannot read Tenant B agency by explicit ID
      const bLookup = await client.query('SELECT * FROM agencies WHERE id = $1', [tenantB]);
      assert.equal(bLookup.rows.length, 0, 'Cross-tenant lookup on agencies must return 0 rows');

      // 6.3 Cannot read Tenant B locations
      const locB = await client.query('SELECT * FROM locations WHERE agency_id = $1', [tenantB]);
      assert.equal(locB.rows.length, 0, 'Cross-tenant lookup on locations must return 0 rows');

      // 6.4 Cannot read Tenant B appointments
      const apptB = await client.query('SELECT * FROM appointments WHERE agency_id = $1', [tenantB]);
      assert.equal(apptB.rows.length, 0, 'Cross-tenant lookup on appointments must return 0 rows');

      // 6.5 Cross-tenant UPDATE is blocked (0 rows affected)
      const updateRes = await client.query("UPDATE agencies SET name = 'Hacked' WHERE id = $1", [tenantB]);
      assert.equal(updateRes.rowCount, 0, 'Cross-tenant UPDATE must affect 0 rows');

      // 6.6 Cross-tenant DELETE is blocked (0 rows affected)
      const deleteRes = await client.query('DELETE FROM agencies WHERE id = $1', [tenantB]);
      assert.equal(deleteRes.rowCount, 0, 'Cross-tenant DELETE must affect 0 rows');

      // 6.7 Cross-tenant INSERT is rejected by WITH CHECK policy
      await assert.rejects(
        () => client.query('INSERT INTO agencies (id, name, slug) VALUES ($1, $2, $3)', [tenantB, 'Spoofed Agency', 'spoofed-agency']),
        /violates row-level security policy/i,
        'Cross-tenant INSERT must fail RLS WITH CHECK policy'
      );

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  await t.test('7. operza_app: Same-agency cross-location isolation', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      // Bound to Tenant A and Location A1
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA1]);

      // Can see Location A1 appointment
      const appts = await client.query('SELECT * FROM appointments');
      assert.equal(appts.rows.length, 1);
      assert.equal(appts.rows[0].location_id, locationA1);

      // Cannot see Location A2 appointment even though same agency
      const a2Lookup = await client.query('SELECT * FROM appointments WHERE location_id = $1', [locationA2]);
      assert.equal(a2Lookup.rows.length, 0, 'Cross-location appointment query must return 0 rows');

      // Attempting to insert an appointment for Location A2 while bound to Location A1 fails RLS
      await assert.rejects(
        () => client.query(`
          INSERT INTO appointments (id, agency_id, location_id, calendar_id, title, starts_at, ends_at, status)
          VALUES ($1, $2, $3, (SELECT id FROM calendars WHERE agency_id = $2 LIMIT 1), 'Spoofed Loc', '2026-12-01T15:00:00Z', '2026-12-01T15:30:00Z', 'confirmed')
        `, [randomUUID(), tenantA, locationA2]),
        /violates row-level security policy/i,
        'Cross-location INSERT must fail RLS WITH CHECK policy'
      );

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  await t.test('8. operza_app: Session resolution & Auth helper functions', async () => {
    const client = await appPool.connect();
    try {
      // 8.1 Valid session token resolves cleanly via security-definer helper
      const validSess = await client.query('SELECT * FROM resolve_auth_session($1)', [tokenHashA]);
      assert.equal(validSess.rows.length, 1);
      assert.equal(validSess.rows[0].user_id, userA);
      assert.equal(validSess.rows[0].agency_id, tenantA);
      assert.equal(validSess.rows[0].user_email, 'alice@alpha.com');
      assert.equal(validSess.rows[0].agency_slug, 'agency-alpha');

      // 8.2 Unknown or expired token returns 0 rows
      const invalidSess = await client.query('SELECT * FROM resolve_auth_session($1)', ['unknown_hash_1234567890']);
      assert.equal(invalidSess.rows.length, 0);

      // 8.3 User lookup by email returns expected row
      const userLookup = await client.query('SELECT * FROM lookup_user_for_auth($1)', ['alice@alpha.com']);
      assert.equal(userLookup.rows.length, 1);
      assert.equal(userLookup.rows[0].id, userA);
      assert.equal(userLookup.rows[0].password_hash, 'hashA');

      // 8.4 Non-existent user lookup returns 0 rows
      const nonUser = await client.query('SELECT * FROM lookup_user_for_auth($1)', ['nobody@nowhere.com']);
      assert.equal(nonUser.rows.length, 0);

      // 8.5 Public calendar lookup by slug returns exact single calendar
      const pubCal = await client.query('SELECT * FROM lookup_public_calendar($1)', ['alpha-cal-1']);
      assert.equal(pubCal.rows.length, 1);
      assert.equal(pubCal.rows[0].agency_id, tenantA);
      assert.equal(pubCal.rows[0].slug, 'alpha-cal-1');

      // 8.6 Non-existent slug returns 0 rows
      const nonCal = await client.query('SELECT * FROM lookup_public_calendar($1)', ['non-existent-cal']);
      assert.equal(nonCal.rows.length, 0);
    } finally {
      client.release();
    }
  });

  // 9. TEST: operza_worker role least-privilege & tenant scoping
  await t.test('9. operza_worker: Fails closed when tenant context is missing', async () => {
    const client = await workerPool.connect();
    try {
      // No set_config applied
      const defs = await client.query('SELECT * FROM workflow_definitions');
      assert.equal(defs.rows.length, 0, 'workflow_definitions must return 0 rows without tenant context');

      const execs = await client.query('SELECT * FROM workflow_executions');
      assert.equal(execs.rows.length, 0, 'workflow_executions must return 0 rows without tenant context');

      const approvals = await client.query('SELECT * FROM workflow_approvals');
      assert.equal(approvals.rows.length, 0, 'workflow_approvals must return 0 rows without tenant context');

      const crmRecords = await client.query('SELECT * FROM location_records');
      assert.equal(crmRecords.rows.length, 0, 'location_records must return 0 rows without tenant context');

      const consents = await client.query('SELECT * FROM communication_consents');
      assert.equal(consents.rows.length, 0, 'communication_consents must return 0 rows without tenant context');
    } finally {
      client.release();
    }
  });

  await t.test('9b. operza_worker: Fails closed on location-scoped tables when location context is missing', async () => {
    const client = await workerPool.connect();
    try {
      await client.query('BEGIN');
      // Set only agency_id, omitting location_id
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', '', true)", [tenantA]);
      const crmRecords = await client.query('SELECT * FROM location_records');
      assert.equal(crmRecords.rows.length, 0, 'location_records must return 0 rows without location context');
      const opps = await client.query('SELECT * FROM opportunities');
      assert.equal(opps.rows.length, 0, 'opportunities must return 0 rows without location context');
      const appts = await client.query('SELECT * FROM appointments');
      assert.equal(appts.rows.length, 0, 'appointments must return 0 rows without location context');
      const execs = await client.query('SELECT * FROM workflow_executions');
      assert.equal(execs.rows.length, 0, 'workflow_executions must return 0 rows without location context');
      const steps = await client.query('SELECT * FROM workflow_execution_steps');
      assert.equal(steps.rows.length, 0, 'workflow_execution_steps must return 0 rows without location context');
      const approvals = await client.query('SELECT * FROM workflow_approvals');
      assert.equal(approvals.rows.length, 0, 'workflow_approvals must return 0 rows without location context');
      const receipts = await client.query('SELECT * FROM workflow_action_receipts');
      assert.equal(receipts.rows.length, 0, 'workflow_action_receipts must return 0 rows without location context');
      const consents = await client.query('SELECT * FROM communication_consents');
      assert.equal(consents.rows.length, 0, 'communication_consents must return 0 rows without location context');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  await t.test('10. operza_worker: Strict tenant isolation during job execution', async () => {
    // Seed workflow definitions and executions for Tenant A and Tenant B
    const flowIdA = randomUUID();
    const flowIdB = randomUUID();
    const execIdA = randomUUID();
    const execIdB = randomUUID();

    await superuserPool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, trigger_type, nodes)
      VALUES ($1, $2, $3, 'Alpha Workflow', 'webhook', '[]'::jsonb)
    `, [flowIdA, tenantA, locationA1]);

    await superuserPool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, trigger_type, nodes)
      VALUES ($1, $2, $3, 'Beta Workflow', 'webhook', '[]'::jsonb)
    `, [flowIdB, tenantB, locationB1]);

    await superuserPool.query(`
      INSERT INTO workflow_executions (id, agency_id, location_id, workflow_id, status)
      VALUES ($1, $2, $3, $4, 'running')
    `, [execIdA, tenantA, locationA1, flowIdA]);

    await superuserPool.query(`
      INSERT INTO workflow_executions (id, agency_id, location_id, workflow_id, status)
      VALUES ($1, $2, $3, $4, 'running')
    `, [execIdB, tenantB, locationB1, flowIdB]);

    const client = await workerPool.connect();
    try {
      await client.query('BEGIN');
      // Worker binds to Tenant A context when executing a Tenant A job
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA1]);

      // Can see Tenant A workflow definition
      const defsA = await client.query('SELECT * FROM workflow_definitions');
      assert.equal(defsA.rows.length, 1);
      assert.equal(defsA.rows[0].id, flowIdA);

      // Cannot see Tenant B workflow definition
      const defsBLookup = await client.query('SELECT * FROM workflow_definitions WHERE id = $1', [flowIdB]);
      assert.equal(defsBLookup.rows.length, 0, 'Worker must not see other tenant definitions');

      // Can see Tenant A execution
      const execsA = await client.query('SELECT * FROM workflow_executions');
      assert.equal(execsA.rows.length, 1);
      assert.equal(execsA.rows[0].id, execIdA);

      // Cannot see Tenant B execution
      const execsBLookup = await client.query('SELECT * FROM workflow_executions WHERE id = $1', [execIdB]);
      assert.equal(execsBLookup.rows.length, 0, 'Worker must not see other tenant executions');

      // Cannot update Tenant B execution
      const updRes = await client.query("UPDATE workflow_executions SET status = 'completed' WHERE id = $1", [execIdB]);
      assert.equal(updRes.rowCount, 0, 'Worker cannot update other tenant executions');

      // Cannot insert execution for Tenant B
      await assert.rejects(
        () => client.query(`
          INSERT INTO workflow_executions (id, agency_id, location_id, workflow_id, status)
          VALUES ($1, $2, $3, $4, 'pending')
        `, [randomUUID(), tenantB, locationB1, flowIdB]),
        /violates row-level security policy/i,
        'Worker cannot insert executions for another tenant'
      );

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  await t.test('10b. operza_worker: Strict cross-location isolation within the same agency', async () => {
    // Seed location_records for Location A1 and Location A2 in Tenant A
    const recIdA1 = randomUUID();
    const recIdA2 = randomUUID();
    await superuserPool.query(`
      INSERT INTO location_records (id, agency_id, location_id, collection, body)
      VALUES ($1, $2, $3, 'contacts', '{"name":"A1"}'::jsonb),
             ($4, $2, $5, 'contacts', '{"name":"A2"}'::jsonb)
    `, [recIdA1, tenantA, locationA1, recIdA2, locationA2]);

    const client = await workerPool.connect();
    try {
      await client.query('BEGIN');
      // Worker operates strictly within Location A1
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA1]);

      // Can see Location A1 record
      const rowsA1 = await client.query('SELECT * FROM location_records WHERE id = $1', [recIdA1]);
      assert.equal(rowsA1.rows.length, 1);

      // Cannot see Location A2 record
      const rowsA2 = await client.query('SELECT * FROM location_records WHERE id = $1', [recIdA2]);
      assert.equal(rowsA2.rows.length, 0, 'Worker must not see other location records in same agency');

      // Cannot update Location A2 record
      const upd = await client.query("UPDATE location_records SET body = '{\"name\":\"hacked\"}'::jsonb WHERE id = $1", [recIdA2]);
      assert.equal(upd.rowCount, 0, 'Worker must not update other location records');

      // Cannot insert record for Location A2
      await assert.rejects(
        () => client.query(`
          INSERT INTO location_records (id, agency_id, location_id, collection, body)
          VALUES ($1, $2, $3, 'contacts', '{"name":"invalid"}'::jsonb)
        `, [randomUUID(), tenantA, locationA2]),
        /violates row-level security policy/i,
        'Worker cannot insert records for other locations'
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  await t.test('11. Authoritative PostgreSQL Approval Expiration & Adversarial Location Boundary Verification', async () => {
    // Seed expired approvals in two different locations of Tenant A, plus an active approval
    const flowIdA1 = randomUUID();
    const flowIdA2 = randomUUID();
    const expiredExecA1 = randomUUID();
    const expiredExecA2 = randomUUID();
    const activeExecA1 = randomUUID();
    const expiredApprA1 = randomUUID();
    const expiredApprA2 = randomUUID();
    const activeApprA1 = randomUUID();

    await superuserPool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, trigger_type, nodes)
      VALUES ($1, $2, $3, 'Flow A1', 'form', '[]'::jsonb),
             ($4, $2, $5, 'Flow A2', 'form', '[]'::jsonb)
    `, [flowIdA1, tenantA, locationA1, flowIdA2, locationA2]);

    // Seed expired approval in Location A1 (expires in past)
    await superuserPool.query(`
      INSERT INTO workflow_executions (id, agency_id, location_id, workflow_id, status)
      VALUES ($1, $2, $3, $4, 'waiting_approval')
    `, [expiredExecA1, tenantA, locationA1, flowIdA1]);

    await superuserPool.query(`
      INSERT INTO workflow_execution_steps (id, agency_id, location_id, execution_id, node_id, status)
      VALUES ($1, $2, $3, $4, 'gate_node_a1', 'waiting_approval')
    `, [randomUUID(), tenantA, locationA1, expiredExecA1]);

    await superuserPool.query(`
      INSERT INTO workflow_approvals (id, agency_id, location_id, execution_id, workflow_id, node_id, action_id, action_hash, status, requested_at, expires_at, request_checksum)
      VALUES ($1, $2, $3, $4, $5, 'gate_node_a1', 'action_crm', '${'0'.repeat(64)}', 'pending', now() - interval '2 hours', now() - interval '1 hour', '${'1'.repeat(64)}')
    `, [expiredApprA1, tenantA, locationA1, expiredExecA1, flowIdA1]);

    // Seed expired approval in Location A2 (expires in past)
    await superuserPool.query(`
      INSERT INTO workflow_executions (id, agency_id, location_id, workflow_id, status)
      VALUES ($1, $2, $3, $4, 'waiting_approval')
    `, [expiredExecA2, tenantA, locationA2, flowIdA2]);

    await superuserPool.query(`
      INSERT INTO workflow_execution_steps (id, agency_id, location_id, execution_id, node_id, status)
      VALUES ($1, $2, $3, $4, 'gate_node_a2', 'waiting_approval')
    `, [randomUUID(), tenantA, locationA2, expiredExecA2]);

    await superuserPool.query(`
      INSERT INTO workflow_approvals (id, agency_id, location_id, execution_id, workflow_id, node_id, action_id, action_hash, status, requested_at, expires_at, request_checksum)
      VALUES ($1, $2, $3, $4, $5, 'gate_node_a2', 'action_crm', '${'0'.repeat(64)}', 'pending', now() - interval '2 hours', now() - interval '1 hour', '${'2'.repeat(64)}')
    `, [expiredApprA2, tenantA, locationA2, expiredExecA2, flowIdA2]);

    // Seed active approval in Location A1 (expires in future)
    await superuserPool.query(`
      INSERT INTO workflow_executions (id, agency_id, location_id, workflow_id, status)
      VALUES ($1, $2, $3, $4, 'waiting_approval')
    `, [activeExecA1, tenantA, locationA1, flowIdA1]);

    await superuserPool.query(`
      INSERT INTO workflow_execution_steps (id, agency_id, location_id, execution_id, node_id, status)
      VALUES ($1, $2, $3, $4, 'gate_node_a1_active', 'waiting_approval')
    `, [randomUUID(), tenantA, locationA1, activeExecA1]);

    await superuserPool.query(`
      INSERT INTO workflow_approvals (id, agency_id, location_id, execution_id, workflow_id, node_id, action_id, action_hash, status, requested_at, expires_at, request_checksum)
      VALUES ($1, $2, $3, $4, $5, 'gate_node_a1_active', 'action_crm', '${'0'.repeat(64)}', 'pending', now(), now() + interval '24 hours', '${'3'.repeat(64)}')
    `, [activeApprA1, tenantA, locationA1, activeExecA1, flowIdA1]);

    // Verification helper: prove records remain strictly pending and unmodified
    async function assertRecordsPending(apprId, execId, stepNodeId) {
      const a = await superuserPool.query('SELECT status, decided_at FROM workflow_approvals WHERE id = $1', [apprId]);
      assert.equal(a.rows[0].status, 'pending', `Approval ${apprId} must be pending`);
      assert.equal(a.rows[0].decided_at, null, `Approval ${apprId} decided_at must be null`);

      const e = await superuserPool.query('SELECT status, last_error_code FROM workflow_executions WHERE id = $1', [execId]);
      assert.equal(e.rows[0].status, 'waiting_approval', `Execution ${execId} status must be waiting_approval`);
      assert.equal(e.rows[0].last_error_code, null, `Execution ${execId} last_error_code must be null`);

      const s = await superuserPool.query('SELECT status, error_code FROM workflow_execution_steps WHERE execution_id = $1 AND node_id = $2', [execId, stepNodeId]);
      assert.equal(s.rows[0].status, 'waiting_approval', `Step for ${execId} must be waiting_approval`);
      assert.equal(s.rows[0].error_code, null, `Step error_code must be null`);
    }

    // Initial state check
    await assertRecordsPending(expiredApprA1, expiredExecA1, 'gate_node_a1');
    await assertRecordsPending(expiredApprA2, expiredExecA2, 'gate_node_a2');
    await assertRecordsPending(activeApprA1, activeExecA1, 'gate_node_a1_active');

    // 11.1 operza_app cannot execute global expire_pending_workflow_approvals()
    const appClientGlobal = await appPool.connect();
    try {
      await assert.rejects(
        () => appClientGlobal.query('SELECT * FROM expire_pending_workflow_approvals()'),
        /permission denied for function expire_pending_workflow_approvals/i,
        'operza_app must not have permission to execute global expire_pending_workflow_approvals'
      );
    } finally {
      appClientGlobal.release();
    }
    await assertRecordsPending(expiredApprA1, expiredExecA1, 'gate_node_a1');
    await assertRecordsPending(expiredApprA2, expiredExecA2, 'gate_node_a2');

    // 11.2 Missing agency context (app.agency_id unset or empty) fails closed
    const appClientMissingAgency = await appPool.connect();
    try {
      await appClientMissingAgency.query('BEGIN');
      await appClientMissingAgency.query("SELECT set_config('app.agency_id', '', true), set_config('app.location_id', $1, true)", [locationA1]);
      await assert.rejects(
        () => appClientMissingAgency.query('SELECT * FROM expire_tenant_workflow_approvals($1, $2)', [tenantA, locationA1]),
        /TENANT_CONTEXT_MISMATCH/i,
        'Must reject when app.agency_id context is empty'
      );
    } finally {
      await appClientMissingAgency.query('ROLLBACK').catch(() => {});
      appClientMissingAgency.release();
    }
    await assertRecordsPending(expiredApprA1, expiredExecA1, 'gate_node_a1');
    await assertRecordsPending(expiredApprA2, expiredExecA2, 'gate_node_a2');

    // 11.3 Missing location context (app.location_id unset) fails closed
    const appClientMissingLocation = await appPool.connect();
    try {
      await appClientMissingLocation.query('BEGIN');
      await appClientMissingLocation.query("SELECT set_config('app.agency_id', $1, true)", [tenantA]);
      await assert.rejects(
        () => appClientMissingLocation.query('SELECT * FROM expire_tenant_workflow_approvals($1, $2)', [tenantA, locationA1]),
        /TENANT_CONTEXT_MISMATCH/i,
        'Must reject when app.location_id context is missing'
      );
    } finally {
      await appClientMissingLocation.query('ROLLBACK').catch(() => {});
      appClientMissingLocation.release();
    }
    await assertRecordsPending(expiredApprA1, expiredExecA1, 'gate_node_a1');
    await assertRecordsPending(expiredApprA2, expiredExecA2, 'gate_node_a2');

    // 11.4 Empty location context (app.location_id = '') fails closed
    const appClientEmptyLocation = await appPool.connect();
    try {
      await appClientEmptyLocation.query('BEGIN');
      await appClientEmptyLocation.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', '', true)", [tenantA]);
      await assert.rejects(
        () => appClientEmptyLocation.query('SELECT * FROM expire_tenant_workflow_approvals($1, $2)', [tenantA, locationA1]),
        /TENANT_CONTEXT_MISMATCH/i,
        'Must reject when app.location_id context is empty string'
      );
    } finally {
      await appClientEmptyLocation.query('ROLLBACK').catch(() => {});
      appClientEmptyLocation.release();
    }
    await assertRecordsPending(expiredApprA1, expiredExecA1, 'gate_node_a1');
    await assertRecordsPending(expiredApprA2, expiredExecA2, 'gate_node_a2');

    // 11.5 NULL arguments fail closed with ARGUMENT_REQUIRED
    {
      const client = await appPool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA1]);
        await assert.rejects(
          () => client.query('SELECT * FROM expire_tenant_workflow_approvals($1, NULL)', [tenantA]),
          /ARGUMENT_REQUIRED/i,
          'Must reject when p_location_id argument is NULL'
        );
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    }
    {
      const client = await appPool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA1]);
        await assert.rejects(
          () => client.query('SELECT * FROM expire_tenant_workflow_approvals(NULL, $1)', [locationA1]),
          /ARGUMENT_REQUIRED/i,
          'Must reject when p_agency_id argument is NULL'
        );
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    }
    await assertRecordsPending(expiredApprA1, expiredExecA1, 'gate_node_a1');
    await assertRecordsPending(expiredApprA2, expiredExecA2, 'gate_node_a2');

    // 11.6 Cross-location in same agency fails closed (context is locationA1, argument is locationA2)
    const appClientCrossLoc = await appPool.connect();
    try {
      await appClientCrossLoc.query('BEGIN');
      await appClientCrossLoc.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA1]);
      await assert.rejects(
        () => appClientCrossLoc.query('SELECT * FROM expire_tenant_workflow_approvals($1, $2)', [tenantA, locationA2]),
        /TENANT_CONTEXT_MISMATCH/i,
        'Must reject when p_location_id does not match active app.location_id context'
      );
    } finally {
      await appClientCrossLoc.query('ROLLBACK').catch(() => {});
      appClientCrossLoc.release();
    }
    await assertRecordsPending(expiredApprA1, expiredExecA1, 'gate_node_a1');
    await assertRecordsPending(expiredApprA2, expiredExecA2, 'gate_node_a2');

    // 11.7 Cross-agency and cross-location fails closed
    const appClientCrossTenant = await appPool.connect();
    try {
      await appClientCrossTenant.query('BEGIN');
      await appClientCrossTenant.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA1]);
      await assert.rejects(
        () => appClientCrossTenant.query('SELECT * FROM expire_tenant_workflow_approvals($1, $2)', [tenantB, locationB1]),
        /TENANT_CONTEXT_MISMATCH/i,
        'Must reject when p_agency_id and p_location_id do not match active tenant context'
      );
    } finally {
      await appClientCrossTenant.query('ROLLBACK').catch(() => {});
      appClientCrossTenant.release();
    }
    await assertRecordsPending(expiredApprA1, expiredExecA1, 'gate_node_a1');
    await assertRecordsPending(expiredApprA2, expiredExecA2, 'gate_node_a2');

    // 11.8 Malformed UUID session context fails closed
    const appClientMalformedUuid = await appPool.connect();
    try {
      await appClientMalformedUuid.query('BEGIN');
      await appClientMalformedUuid.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', 'not-a-valid-uuid', true)", [tenantA]);
      await assert.rejects(
        () => appClientMalformedUuid.query('SELECT * FROM expire_tenant_workflow_approvals($1, $2)', [tenantA, locationA1]),
        /TENANT_CONTEXT_MISMATCH/i,
        'Must reject when app.location_id context is not a valid UUID'
      );
    } finally {
      await appClientMalformedUuid.query('ROLLBACK').catch(() => {});
      appClientMalformedUuid.release();
    }
    await assertRecordsPending(expiredApprA1, expiredExecA1, 'gate_node_a1');
    await assertRecordsPending(expiredApprA2, expiredExecA2, 'gate_node_a2');

    // 11.9 Valid location A1 call: expires ONLY location A1, Location A2 remains strictly pending
    const appClientValid = await appPool.connect();
    try {
      await appClientValid.query('BEGIN');
      await appClientValid.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA1]);
      const expiredRes = await appClientValid.query('SELECT * FROM expire_tenant_workflow_approvals($1, $2)', [tenantA, locationA1]);
      await appClientValid.query('COMMIT');

      assert.equal(expiredRes.rows.length, 1, 'Exactly one approval in Location A1 must be expired');
      assert.equal(expiredRes.rows[0].expired_approval_id, expiredApprA1);
      assert.equal(expiredRes.rows[0].agency_id, tenantA);
      assert.equal(expiredRes.rows[0].location_id, locationA1);
      assert.equal(expiredRes.rows[0].execution_id, expiredExecA1);
      assert.equal(expiredRes.rows[0].node_id, 'gate_node_a1');
    } finally {
      appClientValid.release();
    }

    // Verify Location A1 approval is expired
    const checkApprA1 = await superuserPool.query('SELECT status, decided_at FROM workflow_approvals WHERE id = $1', [expiredApprA1]);
    assert.equal(checkApprA1.rows[0].status, 'expired', 'Location A1 approval status must be expired');
    assert.ok(checkApprA1.rows[0].decided_at, 'Location A1 decided_at must be set');

    const checkExecA1 = await superuserPool.query('SELECT status, last_error_code FROM workflow_executions WHERE id = $1', [expiredExecA1]);
    assert.equal(checkExecA1.rows[0].status, 'failed', 'Location A1 execution status must be failed');
    assert.equal(checkExecA1.rows[0].last_error_code, 'APPROVAL_EXPIRED');

    const checkStepA1 = await superuserPool.query('SELECT status, error_code FROM workflow_execution_steps WHERE execution_id = $1 AND node_id = $2', [expiredExecA1, 'gate_node_a1']);
    assert.equal(checkStepA1.rows[0].status, 'failed', 'Location A1 step status must be failed');
    assert.equal(checkStepA1.rows[0].error_code, 'APPROVAL_EXPIRED');

    // CRUCIAL: Verify Location A2 (in same agency!) remained untouched and strictly pending
    await assertRecordsPending(expiredApprA2, expiredExecA2, 'gate_node_a2');

    // Verify Active approval in Location A1 remained pending
    await assertRecordsPending(activeApprA1, activeExecA1, 'gate_node_a1_active');

    // 11.10 operza_worker CAN execute global expire_pending_workflow_approvals() across all tenants/locations
    const expiredTenantBExecId = randomUUID();
    const expiredTenantBApprId = randomUUID();
    const flowIdB = randomUUID();
    await superuserPool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, trigger_type, nodes)
      VALUES ($1, $2, $3, 'Beta Approval Flow', 'form', '[]'::jsonb)
    `, [flowIdB, tenantB, locationB1]);
    await superuserPool.query(`
      INSERT INTO workflow_executions (id, agency_id, location_id, workflow_id, status)
      VALUES ($1, $2, $3, $4, 'waiting_approval')
    `, [expiredTenantBExecId, tenantB, locationB1, flowIdB]);
    await superuserPool.query(`
      INSERT INTO workflow_execution_steps (id, agency_id, location_id, execution_id, node_id, status)
      VALUES ($1, $2, $3, $4, 'gate_node_b', 'waiting_approval')
    `, [randomUUID(), tenantB, locationB1, expiredTenantBExecId]);
    await superuserPool.query(`
      INSERT INTO workflow_approvals (id, agency_id, location_id, execution_id, workflow_id, node_id, action_id, action_hash, status, requested_at, expires_at, request_checksum)
      VALUES ($1, $2, $3, $4, $5, 'gate_node_b', 'action_crm', '${'0'.repeat(64)}', 'pending', now() - interval '2 hours', now() - interval '1 hour', '${'4'.repeat(64)}')
    `, [expiredTenantBApprId, tenantB, locationB1, expiredTenantBExecId, flowIdB]);

    const workerExpireClient = await workerPool.connect();
    try {
      const workerExpireRes = await workerExpireClient.query('SELECT * FROM expire_pending_workflow_approvals()');
      const expiredIds = workerExpireRes.rows.map(r => r.expired_approval_id);
      assert.ok(expiredIds.includes(expiredApprA2), 'operza_worker must expire Location A2 approval in global pass');
      assert.ok(expiredIds.includes(expiredTenantBApprId), 'operza_worker must expire Tenant B approval in global pass');
    } finally {
      workerExpireClient.release();
    }

    // Verify Location A2 is now expired after global worker sweep
    const checkApprA2 = await superuserPool.query('SELECT status, decided_at FROM workflow_approvals WHERE id = $1', [expiredApprA2]);
    assert.equal(checkApprA2.rows[0].status, 'expired', 'Location A2 approval status must be expired by worker');

    // Active approval remains pending
    await assertRecordsPending(activeApprA1, activeExecA1, 'gate_node_a1_active');
  });

  await t.test('12. Function Execution Privileges (PUBLIC revoked, least-privilege enforced)', async () => {
    // PUBLIC pseudo-role must NOT have execute on any security definer functions
    const publicChecks = await superuserPool.query(`
      SELECT
        has_function_privilege('public', 'resolve_auth_session(text)', 'execute') AS resolve_auth,
        has_function_privilege('public', 'lookup_user_for_auth(text)', 'execute') AS lookup_user,
        has_function_privilege('public', 'lookup_public_calendar(text)', 'execute') AS lookup_cal,
        has_function_privilege('public', 'expire_pending_workflow_approvals()', 'execute') AS expire_appr,
        has_function_privilege('public', 'expire_tenant_workflow_approvals(uuid,uuid)', 'execute') AS expire_tenant
    `);
    assert.equal(publicChecks.rows[0].resolve_auth, false, 'PUBLIC must not execute resolve_auth_session');
    assert.equal(publicChecks.rows[0].lookup_user, false, 'PUBLIC must not execute lookup_user_for_auth');
    assert.equal(publicChecks.rows[0].lookup_cal, false, 'PUBLIC must not execute lookup_public_calendar');
    assert.equal(publicChecks.rows[0].expire_appr, false, 'PUBLIC must not execute expire_pending_workflow_approvals');
    assert.equal(publicChecks.rows[0].expire_tenant, false, 'PUBLIC must not execute expire_tenant_workflow_approvals');

    // operza_worker must NOT have execute on auth functions, but CAN execute expiration functions
    const workerChecks = await superuserPool.query(`
      SELECT
        has_function_privilege('operza_worker', 'lookup_user_for_auth(text)', 'execute') AS lookup_user,
        has_function_privilege('operza_worker', 'resolve_auth_session(text)', 'execute') AS resolve_auth,
        has_function_privilege('operza_worker', 'expire_pending_workflow_approvals()', 'execute') AS expire_appr,
        has_function_privilege('operza_worker', 'expire_tenant_workflow_approvals(uuid,uuid)', 'execute') AS expire_tenant
    `);
    assert.equal(workerChecks.rows[0].lookup_user, false, 'operza_worker must not execute lookup_user_for_auth');
    assert.equal(workerChecks.rows[0].resolve_auth, false, 'operza_worker must not execute resolve_auth_session');
    assert.equal(workerChecks.rows[0].expire_appr, true, 'operza_worker must execute expire_pending_workflow_approvals');
    assert.equal(workerChecks.rows[0].expire_tenant, true, 'operza_worker must execute expire_tenant_workflow_approvals');

    // operza_app must have execute on scoped functions but NOT global maintenance expiration
    const appChecks = await superuserPool.query(`
      SELECT
        has_function_privilege('operza_app', 'resolve_auth_session(text)', 'execute') AS resolve_auth,
        has_function_privilege('operza_app', 'lookup_user_for_auth(text)', 'execute') AS lookup_user,
        has_function_privilege('operza_app', 'lookup_public_calendar(text)', 'execute') AS lookup_cal,
        has_function_privilege('operza_app', 'expire_pending_workflow_approvals()', 'execute') AS expire_appr,
        has_function_privilege('operza_app', 'expire_tenant_workflow_approvals(uuid,uuid)', 'execute') AS expire_tenant
    `);
    assert.equal(appChecks.rows[0].resolve_auth, true, 'operza_app must execute resolve_auth_session');
    assert.equal(appChecks.rows[0].lookup_user, true, 'operza_app must execute lookup_user_for_auth');
    assert.equal(appChecks.rows[0].lookup_cal, true, 'operza_app must execute lookup_public_calendar');
    assert.equal(appChecks.rows[0].expire_appr, false, 'operza_app must NOT execute global expire_pending_workflow_approvals');
    assert.equal(appChecks.rows[0].expire_tenant, true, 'operza_app must execute expire_tenant_workflow_approvals');
  });

  await t.test('13. Security Definer Function Ownership & Definer Role Isolation', async () => {
    const fnOwnerRes = await superuserPool.query(`
      SELECT p.proname, r.rolname
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname IN ('resolve_auth_session', 'lookup_user_for_auth', 'lookup_public_calendar', 'expire_pending_workflow_approvals', 'expire_tenant_workflow_approvals')
    `);
    assert.equal(fnOwnerRes.rows.length, 5, 'Must find all 5 security definer functions');
    for (const row of fnOwnerRes.rows) {
      assert.equal(row.rolname, 'operza_auth_definer', `Function ${row.proname} must be owned by operza_auth_definer`);
    }

    // Role operza_auth_definer attributes
    const definerRoleRes = await superuserPool.query(`
      SELECT rolname, rolsuper, rolcanlogin, rolbypassrls, rolinherit
      FROM pg_roles
      WHERE rolname = 'operza_auth_definer'
    `);
    assert.equal(definerRoleRes.rows.length, 1);
    const defRow = definerRoleRes.rows[0];
    assert.equal(defRow.rolsuper, false, 'operza_auth_definer must NOT be superuser');
    assert.equal(defRow.rolcanlogin, false, 'operza_auth_definer must NOT be able to login');
    assert.equal(defRow.rolbypassrls, true, 'operza_auth_definer must have BYPASSRLS');
  });

  await t.test('14. Table Matrix Least-Privilege & Append-Only Verification', async () => {
    // 14.1 operza_app cannot UPDATE or DELETE on agency_audit_events
    {
      const client = await appPool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA1]);

        // INSERT is permitted
        await client.query(`
          INSERT INTO agency_audit_events (id, agency_id, location_id, action, resource, details)
          VALUES ($1, $2, $3, 'test.event', 'test_resource', '{}'::jsonb)
        `, [randomUUID(), tenantA, locationA1]);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    }

    {
      const client = await appPool.connect();
      try {
        await client.query("SELECT set_config('app.agency_id', $1, false), set_config('app.location_id', $2, false)", [tenantA, locationA1]);
        await assert.rejects(
          () => client.query("UPDATE agency_audit_events SET action = 'tampered'"),
          /permission denied for table agency_audit_events/i,
          'operza_app must not be able to UPDATE agency_audit_events'
        );
      } finally {
        client.release();
      }
    }

    {
      const client = await appPool.connect();
      try {
        await client.query("SELECT set_config('app.agency_id', $1, false), set_config('app.location_id', $2, false)", [tenantA, locationA1]);
        await assert.rejects(
          () => client.query('DELETE FROM agency_audit_events'),
          /permission denied for table agency_audit_events/i,
          'operza_app must not be able to DELETE agency_audit_events'
        );
      } finally {
        client.release();
      }
    }

    // 14.2 operza_worker has NO DELETE privileges on any tenant tables
    for (const table of ['workflow_definitions', 'workflow_executions', 'appointments']) {
      const client = await workerPool.connect();
      try {
        await client.query("SELECT set_config('app.agency_id', $1, false), set_config('app.location_id', $2, false)", [tenantA, locationA1]);
        await assert.rejects(
          () => client.query(`DELETE FROM ${table}`),
          new RegExp(`permission denied for table ${table}`, 'i'),
          `operza_worker must not have DELETE on ${table}`
        );
      } finally {
        client.release();
      }
    }
  });

  await t.test('15. Location Isolation on workflow_definitions and calendars for app & worker', async () => {
    const flowLoc1 = randomUUID();
    const flowLoc2 = randomUUID();
    await superuserPool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, trigger_type, nodes)
      VALUES ($1, $2, $3, 'Flow Loc 1', 'webhook', '[]'::jsonb)
    `, [flowLoc1, tenantA, locationA1]);
    await superuserPool.query(`
      INSERT INTO workflow_definitions (id, agency_id, location_id, name, trigger_type, nodes)
      VALUES ($1, $2, $3, 'Flow Loc 2', 'webhook', '[]'::jsonb)
    `, [flowLoc2, tenantA, locationA2]);

    // operza_app: when scoped to locationA1, cannot see locationA2 workflow_definitions or calendars
    const appClient = await appPool.connect();
    try {
      await appClient.query('BEGIN');
      await appClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA1]);

      const flows = await appClient.query('SELECT id FROM workflow_definitions WHERE agency_id = $1', [tenantA]);
      const flowIds = flows.rows.map(r => r.id);
      assert.ok(flowIds.includes(flowLoc1), 'Must see Flow Loc 1');
      assert.equal(flowIds.includes(flowLoc2), false, 'Must NOT see Flow Loc 2 under locationA1');

      const cals = await appClient.query('SELECT id, location_id FROM calendars WHERE agency_id = $1', [tenantA]);
      for (const cal of cals.rows) {
        assert.equal(cal.location_id, locationA1, 'operza_app must only see calendars matching active location_id');
      }

      await appClient.query('ROLLBACK');
    } finally {
      appClient.release();
    }

    // operza_worker: when scoped to locationA1, cannot see locationA2 workflow_definitions or calendars
    const workerClient = await workerPool.connect();
    try {
      await workerClient.query('BEGIN');
      await workerClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantA, locationA1]);

      const flows = await workerClient.query('SELECT id FROM workflow_definitions WHERE agency_id = $1', [tenantA]);
      const flowIds = flows.rows.map(r => r.id);
      assert.ok(flowIds.includes(flowLoc1), 'Worker must see Flow Loc 1');
      assert.equal(flowIds.includes(flowLoc2), false, 'Worker must NOT see Flow Loc 2 under locationA1');

      const cals = await workerClient.query('SELECT id, location_id FROM calendars WHERE agency_id = $1', [tenantA]);
      for (const cal of cals.rows) {
        assert.equal(cal.location_id, locationA1, 'operza_worker must only see calendars matching active location_id');
      }

      await workerClient.query('ROLLBACK');
    } finally {
      workerClient.release();
    }
  });

  await t.test('16. Negative Role Administration & Privilege Boundary Enforcement', async () => {
    // 16.1 operza_app cannot CREATE ROLE
    {
      const client = await appPool.connect();
      try {
        await assert.rejects(
          () => client.query('CREATE ROLE malicious_app_role;'),
          /permission denied to create role/i,
          'operza_app must not have CREATEROLE'
        );
      } finally {
        client.release();
      }
    }

    // 16.2 operza_worker cannot CREATE ROLE
    {
      const client = await workerPool.connect();
      try {
        await assert.rejects(
          () => client.query('CREATE ROLE malicious_worker_role;'),
          /permission denied to create role/i,
          'operza_worker must not have CREATEROLE'
        );
      } finally {
        client.release();
      }
    }

    // 16.3 operza_app cannot ALTER FUNCTION owner
    {
      const client = await appPool.connect();
      try {
        await assert.rejects(
          () => client.query('ALTER FUNCTION lookup_user_for_auth(text) OWNER TO operza_app;'),
          /must be owner of function|permission denied/i,
          'operza_app must not be able to alter function owner'
        );
      } finally {
        client.release();
      }
    }

    // 16.4 operza_worker cannot ALTER FUNCTION owner
    {
      const client = await workerPool.connect();
      try {
        await assert.rejects(
          () => client.query('ALTER FUNCTION lookup_user_for_auth(text) OWNER TO operza_worker;'),
          /must be owner of function|permission denied/i,
          'operza_worker must not be able to alter function owner'
        );
      } finally {
        client.release();
      }
    }
  });

  await t.test('17. Migration Privilege Failure, Determinism & Security Definer Verification', async () => {
    // 17.1 A migration with insufficient privileges fails visibly when a required role cannot be established
    {
      const client = await migratorPool.connect();
      try {
        await assert.rejects(
          () => client.query(`
            DO $$
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_missing_definer_role') THEN
                BEGIN
                  CREATE ROLE operza_missing_definer_role WITH NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
                EXCEPTION
                  WHEN duplicate_object THEN NULL;
                END;
              END IF;
            END $$;
          `),
          /permission denied to create role|insufficient_privilege/i,
          'Unprivileged migration runner must fail visibly when attempting to establish a missing role without CREATEROLE'
        );
      } finally {
        client.release();
      }
    }

    // 17.2 An existing role does not cause duplicate-object failures (safe concurrency / idempotent bootstrap)
    {
      await superuserPool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_auth_definer') THEN
            BEGIN
              CREATE ROLE operza_auth_definer WITH NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
            EXCEPTION
              WHEN duplicate_object THEN NULL;
            END;
          END IF;
        END $$;
      `);

      await superuserPool.query(`
        DO $$
        BEGIN
          BEGIN
            CREATE ROLE operza_auth_definer WITH NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
          EXCEPTION
            WHEN duplicate_object THEN NULL;
          END;
        END $$;
      `);
    }

    // 17.3 A correctly privileged migration succeeds under unprivileged operza_migrator and validates role properties
    {
      const sql025 = await readFile(path.join(migrationsDir, '025_workflow_definition_and_calendar_location_hardening.sql'), 'utf8');
      // Genuinely execute Migration 025 through unprivileged operza_migrator (not superuserPool)
      await migratorPool.query(sql025);
    }

    // 17.4 Verify operza_auth_definer attributes (NOLOGIN, BYPASSRLS, NOSUPERUSER, NOCREATEDB, NOCREATEROLE)
    {
      const res = await superuserPool.query(`
        SELECT rolname, rolsuper, rolcanlogin, rolbypassrls, rolcreatedb, rolcreaterole
        FROM pg_roles
        WHERE rolname = 'operza_auth_definer'
      `);
      assert.equal(res.rowCount, 1, 'operza_auth_definer role must exist');
      const r = res.rows[0];
      assert.equal(r.rolsuper, false, 'operza_auth_definer must NOT be superuser');
      assert.equal(r.rolcanlogin, false, 'operza_auth_definer must have NOLOGIN');
      assert.equal(r.rolbypassrls, true, 'operza_auth_definer must have BYPASSRLS');
      assert.equal(r.rolcreatedb, false, 'operza_auth_definer must NOT have CREATEDB');
      assert.equal(r.rolcreaterole, false, 'operza_auth_definer must NOT have CREATEROLE');
    }

    // 17.5 Verify operza_app and operza_worker attributes fail closed
    {
      const res = await superuserPool.query(`
        SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit
        FROM pg_roles
        WHERE rolname IN ('operza_app', 'operza_worker')
        ORDER BY rolname
      `);
      assert.equal(res.rowCount, 2, 'Both operza_app and operza_worker roles must exist in PostgreSQL');
      const roleMap = new Map(res.rows.map(r => [r.rolname, r]));
      assert.ok(roleMap.has('operza_app'), 'operza_app must exist');
      assert.ok(roleMap.has('operza_worker'), 'operza_worker must exist');

      for (const [name, r] of roleMap.entries()) {
        assert.equal(r.rolsuper, false, `Role ${name} must NOT be superuser`);
        assert.equal(r.rolbypassrls, false, `Role ${name} must NOT have BYPASSRLS`);
        assert.equal(r.rolcreatedb, false, `Role ${name} must NOT have CREATEDB`);
        assert.equal(r.rolcreaterole, false, `Role ${name} must NOT have CREATEROLE`);
        assert.equal(r.rolcanlogin, true, `Role ${name} must have LOGIN permission`);
        assert.equal(r.rolinherit, false, `Role ${name} must have NOINHERIT`);
      }
    }

    // 17.6 Verify exact five security-definer helper functions exist and are owned by operza_auth_definer
    {
      const expectedSignatures = new Map([
        ['resolve_auth_session(text)', 'operza_auth_definer'],
        ['lookup_user_for_auth(text)', 'operza_auth_definer'],
        ['lookup_public_calendar(text)', 'operza_auth_definer'],
        ['expire_pending_workflow_approvals()', 'operza_auth_definer'],
        ['expire_tenant_workflow_approvals(uuid, uuid)', 'operza_auth_definer']
      ]);

      const res = await superuserPool.query(`
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

      assert.equal(res.rowCount, 5, 'Exactly 5 security-definer helper functions must exist in public schema');
      const foundMap = new Map(res.rows.map(r => [r.signature, r.owner]));

      for (const [signature, expectedOwner] of expectedSignatures.entries()) {
        assert.ok(foundMap.has(signature), `Required function signature "${signature}" must exist in schema public`);
        const actualOwner = foundMap.get(signature);
        assert.equal(actualOwner, expectedOwner, `Function "${signature}" must be owned by "${expectedOwner}", got "${actualOwner}"`);
      }
    }

    // 17.7 Verify required table privileges for operza_auth_definer
    {
      const tables = ['users', 'auth_sessions', 'agencies', 'calendars'];
      for (const table of tables) {
        const check = await superuserPool.query(`
          SELECT has_table_privilege('operza_auth_definer', $1, 'SELECT') AS has_select
        `, [table]);
        assert.equal(check.rows[0].has_select, true, `operza_auth_definer must have SELECT on ${table}`);
      }

      const mutTables = ['workflow_approvals', 'workflow_executions', 'workflow_execution_steps'];
      for (const table of mutTables) {
        const check = await superuserPool.query(`
          SELECT 
            has_table_privilege('operza_auth_definer', $1, 'SELECT') AS has_select,
            has_table_privilege('operza_auth_definer', $1, 'UPDATE') AS has_update
        `, [table]);
        assert.equal(check.rows[0].has_select, true, `operza_auth_definer must have SELECT on ${table}`);
        assert.equal(check.rows[0].has_update, true, `operza_auth_definer must have UPDATE on ${table}`);
      }
    }
  });
});
