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

test('Migrations Inventory: all 32 migrations exist in sequential order', async () => {
  const files = (await readdir(migrationsDir))
    .filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort();

  assert.equal(files.length >= 32, true, `Expected at least 32 migrations, found ${files.length}`);
  
  // Verify sequential numbering 001 through 032
  for (let i = 1; i <= 32; i++) {
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
        IF NOT pg_has_role(current_user, 'operza_auth_definer', 'MEMBER') THEN
          EXECUTE format('GRANT operza_auth_definer TO %I', current_user);
        END IF;
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

    // 3. Verify ALL expected RLS tables exist in public schema and enforce FORCE ROW LEVEL SECURITY
    const EXPECTED_RLS_TABLES = [
      'agencies',
      'agency_audit_events',
      'agency_branding',
      'agency_invitations',
      'agency_memberships',
      'agency_snapshots',
      'agent_conversation_messages',
      'agent_conversation_sessions',
      'agent_tool_executions',
      'ai_bot_configs',
      'ai_knowledge_base',
      'appointments',
      'billing_ledger_accounts',
      'billing_ledger_entries',
      'calendars',
      'communication_consents',
      'copilot_proposals',
      'developer_keys',
      'developer_webhook_deliveries',
      'developer_webhooks',
      'immutable_audit_events',
      'location_records',
      'locations',
      'opportunities',
      'phone_numbers',
      'pipeline_stages',
      'pipelines',
      'provider_connections',
      'provider_oauth_states',
      'provider_secrets',
      'tenant_entitlements',
      'usage_events',
      'users',
      'workflow_action_receipts',
      'workflow_approvals',
      'workflow_definitions',
      'workflow_execution_steps',
      'workflow_executions',
      'workflow_outbox',
      'workflow_templates',
      'zapier_hook_deliveries',
      'zapier_hook_subscriptions',
      'zapier_rest_hook_deliveries',
      'zapier_rest_hook_subscriptions'
    ];

    const rlsCheck = await pool.query(`
      SELECT 
        c.relname,
        c.relrowsecurity,
        c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY c.relname;
    `);

    const tableMap = new Map(rlsCheck.rows.map(r => [r.relname, r]));

    for (const tableName of EXPECTED_RLS_TABLES) {
      assert.ok(tableMap.has(tableName), `Required RLS table "${tableName}" does not exist in schema public`);
      const row = tableMap.get(tableName);
      assert.equal(row.relrowsecurity, true, `Table "${tableName}" must have relrowsecurity = true`);
      assert.equal(row.relforcerowsecurity, true, `Table "${tableName}" must have relforcerowsecurity = true`);
    }

    // 4. Verify role attributes: operza_app and operza_worker must exist and be strictly least-privileged
    const roleCheck = await pool.query(`
      SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit
      FROM pg_roles
      WHERE rolname IN ('operza_app', 'operza_worker')
      ORDER BY rolname
    `);
    assert.equal(roleCheck.rows.length, 2, 'Both operza_app and operza_worker roles must exist in PostgreSQL');
    const roleCheckMap = new Map(roleCheck.rows.map(r => [r.rolname, r]));
    assert.ok(roleCheckMap.has('operza_app'), 'operza_app role must exist');
    assert.ok(roleCheckMap.has('operza_worker'), 'operza_worker role must exist');

    for (const [name, row] of roleCheckMap.entries()) {
      assert.equal(row.rolsuper, false, `Role ${name} must not be superuser`);
      assert.equal(row.rolbypassrls, false, `Role ${name} must not have BYPASSRLS`);
      assert.equal(row.rolcreatedb, false, `Role ${name} must not have CREATEDB`);
      assert.equal(row.rolcreaterole, false, `Role ${name} must not have CREATEROLE`);
      assert.equal(row.rolcanlogin, true, `Role ${name} must have LOGIN permission`);
      assert.equal(row.rolinherit, false, `Role ${name} must have NOINHERIT`);
    }

    // 5. Test RLS Tenant Isolation under operza_app role
    const clientA = await pool.connect();
    const clientB = await pool.connect();
    const clientNoCtx = await pool.connect();

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

      // Switch test clients to the genuine least-privileged application role
      await clientA.query('SET ROLE operza_app');
      await clientB.query('SET ROLE operza_app');
      await clientNoCtx.query('SET ROLE operza_app');

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

      // Tenant B attempts to update Tenant A's opportunity -> MUST AFFECT 0 ROWS
      const crossOppUpdateB = await clientB.query(`
        UPDATE opportunities SET name = 'Tampered Deal'
        WHERE id = $1
      `, [oppIdA]);
      assert.equal(crossOppUpdateB.rowCount, 0, 'Cross-tenant opportunity update must affect 0 rows');

      // Verify Tenant A's opportunity remains intact
      const verifyOppA = await clientA.query('SELECT name FROM opportunities WHERE id = $1', [oppIdA]);
      assert.equal(verifyOppA.rows[0].name, 'Enterprise Deal A', 'Tenant A opportunity name must remain unchanged');

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

      // Adversarial cross-tenant update from Tenant B targeting strictly WHERE id = $1 (no tenant filter)
      const crossUpdateB = await clientB.query(`
        UPDATE workflow_executions
        SET status = 'completed'
        WHERE id = $1
      `, [execId]);
      assert.equal(crossUpdateB.rowCount, 0, 'Adversarial cross-tenant execution update targeting only id must affect 0 rows');

      // Re-query under Tenant A context and assert original status remains unchanged
      const verifyExecA = await clientA.query('SELECT status FROM workflow_executions WHERE id = $1', [execId]);
      assert.equal(verifyExecA.rowCount, 1, 'Tenant A workflow execution must exist');
      assert.equal(verifyExecA.rows[0].status, 'running', 'Tenant A workflow execution status must remain unaltered after cross-tenant update attempt');

      // Same-agency cross-location isolation: Tenant A under locA2 context
      await clientB.query('COMMIT');
      await clientB.query('BEGIN');
      await clientB.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [agencyA, locA2]);
      const crossLocCheck = await clientB.query('SELECT * FROM workflow_executions WHERE id = $1', [execId]);
      assert.equal(crossLocCheck.rowCount, 0, 'Same-agency cross-location query must return 0 rows');

      // Adversarial same-agency cross-location update on workflow execution targeting only id = $1
      const crossLocExecUpdate = await clientB.query(`
        UPDATE workflow_executions
        SET status = 'completed'
        WHERE id = $1
      `, [execId]);
      assert.equal(crossLocExecUpdate.rowCount, 0, 'Adversarial same-agency cross-location execution update must affect 0 rows');

      // Verify workflow execution status under Location A1 context remains unaltered
      const verifyExecLocA1 = await clientA.query('SELECT status FROM workflow_executions WHERE id = $1', [execId]);
      assert.equal(verifyExecLocA1.rowCount, 1, 'Workflow execution must be found under location A1 context');
      assert.equal(verifyExecLocA1.rows[0].status, 'running', 'Workflow execution status must remain unaltered after cross-location update attempt');

      const crossLocOppCheck = await clientB.query('SELECT * FROM opportunities WHERE id = $1', [oppIdA]);
      assert.equal(crossLocOppCheck.rowCount, 0, 'Same-agency cross-location query for opportunities must return 0 rows');

      // Attempt to update Location A1's opportunity while operating as operza_app under Location A2 context
      // Note: We deliberately do NOT include a location filter in the WHERE clause so that RLS alone enforces the isolation
      const crossLocOppUpdate = await clientB.query(`
        UPDATE opportunities 
        SET name = 'CrossLocMutated', value = 999999
        WHERE id = $1
      `, [oppIdA]);
      assert.equal(crossLocOppUpdate.rowCount, 0, 'Cross-location update on opportunity must affect exactly 0 rows due to RLS');

      // Query opportunity again under Location A1 context and verify original values are completely unchanged
      const verifyOppLocA1 = await clientA.query('SELECT id, name, value, status, location_id FROM opportunities WHERE id = $1', [oppIdA]);
      assert.equal(verifyOppLocA1.rowCount, 1, 'Opportunity must be found under its owning location A1 context');
      assert.equal(verifyOppLocA1.rows[0].name, 'Enterprise Deal A', 'Opportunity name must remain unaltered after cross-location update attempt');
      assert.equal(Number(verifyOppLocA1.rows[0].value), 50000, 'Opportunity value must remain unaltered after cross-location update attempt');
      assert.equal(verifyOppLocA1.rows[0].location_id, locA1, 'Opportunity location_id must remain location A1');

      // 5c. Missing tenant context fails closed under operza_app
      await clientNoCtx.query('BEGIN');
      const noCtxOpps = await clientNoCtx.query('SELECT * FROM opportunities WHERE id = $1', [oppIdA]);
      assert.equal(noCtxOpps.rowCount, 0, 'Query without tenant context must return 0 rows for opportunities');

      const noCtxExecs = await clientNoCtx.query('SELECT * FROM workflow_executions WHERE id = $1', [execId]);
      assert.equal(noCtxExecs.rowCount, 0, 'Query without tenant context must return 0 rows for workflow_executions');

      const noCtxUpdate = await clientNoCtx.query("UPDATE opportunities SET name = 'NoCtx' WHERE id = $1", [oppIdA]);
      assert.equal(noCtxUpdate.rowCount, 0, 'Update without tenant context must affect 0 rows');
      await clientNoCtx.query('ROLLBACK');

      // Legitimate Tenant A update
      const validUpdate = await clientA.query(`
        UPDATE workflow_executions SET status = 'completed', updated_at = now()
        WHERE agency_id = $1 AND location_id = $2 AND id = $3
      `, [agencyA, locA1, execId]);
      assert.equal(validUpdate.rowCount, 1, 'Legitimate tenant update must affect exactly 1 row');

      await clientA.query('COMMIT');
      await clientB.query('ROLLBACK');
    } finally {
      await clientA.query('ROLLBACK').catch(() => {});
      await clientB.query('ROLLBACK').catch(() => {});
      await clientNoCtx.query('ROLLBACK').catch(() => {});
      await clientA.query('RESET ROLE').catch(() => {});
      await clientB.query('RESET ROLE').catch(() => {});
      await clientNoCtx.query('RESET ROLE').catch(() => {});
      clientA.release();
      clientB.release();
      clientNoCtx.release();
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
      await auditClient.query('ROLLBACK').catch(() => {});
      auditClient.release();
    }

    // 7. Phase 1.3 Pre-Flight: Real PostgreSQL ContactsRepository.merge & Opportunities Relational Re-link and Rollback Certification
    const mergeClient = await pool.connect();
    try {
      await mergeClient.query('SET ROLE operza_app');
      await mergeClient.query('BEGIN');
      await mergeClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)", [agencyA, locA1, '00000000-0000-4000-8000-000000000001']);

      const primaryContactId = randomUUID();
      const secondaryContactId = randomUUID();
      const relOppId = randomUUID();
      const pipelineId = randomUUID();
      const stageId = randomUUID();

      // Seed primary contact in location_records
      await mergeClient.query(`
        INSERT INTO location_records (id, agency_id, location_id, collection, body, version, created_at, updated_at)
        VALUES ($1, $2, $3, 'contacts', $4, 1, now(), now())
      `, [primaryContactId, agencyA, locA1, JSON.stringify({ firstName: 'Primary', lastName: 'Leader', email: 'primary@lead.io' })]);

      // Seed secondary contact in location_records
      await mergeClient.query(`
        INSERT INTO location_records (id, agency_id, location_id, collection, body, version, created_at, updated_at)
        VALUES ($1, $2, $3, 'contacts', $4, 1, now(), now())
      `, [secondaryContactId, agencyA, locA1, JSON.stringify({ firstName: 'Secondary', lastName: 'Dupe', email: 'dupe@lead.io' })]);

      // Seed opportunity linked to secondary contact
      await mergeClient.query(`
        INSERT INTO opportunities (id, agency_id, location_id, pipeline_id, stage_id, contact_id, name, value, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'Relational Merge Opportunity', 25000, 'open')
      `, [relOppId, agencyA, locA1, pipelineId, stageId, secondaryContactId]);

      // Wrap mergeClient in mock tx for ContactsRepository.merge
      const mockTx = {
        agencyId: agencyA,
        locationId: locA1,
        actorId: '00000000-0000-4000-8000-000000000001',
        query: (sql, params) => mergeClient.query(sql, params)
      };

      const { createContactsRepository } = await import('../lib/contacts-repository.mjs');
      const contactsRepo = createContactsRepository();

      // Execute merge on real PostgreSQL
      const merged = await contactsRepo.merge(mockTx, { primaryId: primaryContactId, mergeIds: [secondaryContactId] });
      assert.equal(merged.success, true);
      assert.equal(merged.primaryId, primaryContactId);

      // Verify on real PostgreSQL: Opportunity's contact_id is now updated to primaryContactId
      const oppAfterMerge = await mergeClient.query('SELECT contact_id FROM opportunities WHERE id = $1', [relOppId]);
      assert.equal(oppAfterMerge.rows[0].contact_id, primaryContactId, 'Opportunity contact_id must be re-linked to primary contact on real PostgreSQL');

      // Verify on real PostgreSQL: Secondary contact is deleted
      const secCheck = await mergeClient.query("SELECT * FROM location_records WHERE id = $1 AND collection = 'contacts'", [secondaryContactId]);
      assert.equal(secCheck.rowCount, 0, 'Secondary contact must be deleted from location_records on real PostgreSQL');

      // Rollback to leave database pristine
      await mergeClient.query('ROLLBACK');

      // Negative Rollback Test: Attempt merge with non-existent secondary contact -> must throw and leave opportunity untouched
      await mergeClient.query('BEGIN');
      await mergeClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)", [agencyA, locA1, '00000000-0000-4000-8000-000000000001']);

      const testPrimaryId = randomUUID();
      const testOppId = randomUUID();
      const nonExistentId = randomUUID();
      const testPipelineId = randomUUID();
      const testStageId = randomUUID();

      await mergeClient.query(`
        INSERT INTO location_records (id, agency_id, location_id, collection, body, version, created_at, updated_at)
        VALUES ($1, $2, $3, 'contacts', $4, 1, now(), now())
      `, [testPrimaryId, agencyA, locA1, JSON.stringify({ firstName: 'Test', lastName: 'Rollback', email: 'rollback@lead.io' })]);

      await mergeClient.query(`
        INSERT INTO opportunities (id, agency_id, location_id, pipeline_id, stage_id, contact_id, name, value, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'Pre-Rollback Opp', 10000, 'open')
      `, [testOppId, agencyA, locA1, testPipelineId, testStageId, testPrimaryId]);

      await assert.rejects(
        () => contactsRepo.merge(mockTx, { primaryId: testPrimaryId, mergeIds: [nonExistentId] }),
        /not found/i
      );

      await mergeClient.query('ROLLBACK');
    } finally {
      await mergeClient.query('ROLLBACK').catch(() => {});
      await mergeClient.query('RESET ROLE').catch(() => {});
      mergeClient.release();
    }

    // ─── REAL POSTGRESQL PIPELINES & FUNNELS REPOSITORY RLS CHECK ───
    const pfClient = await pool.connect();
    try {
      await pfClient.query('SET ROLE operza_app');
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );

      const pfTx = {
        agencyId: agencyA,
        locationId: locA1,
        actorId: '00000000-0000-4000-8000-000000000001',
        query: (sql, params) => pfClient.query(sql, params)
      };

      const { createPipelinesRepository } = await import('../lib/pipelines-repository.mjs');
      const { createFunnelsRepository } = await import('../lib/funnels-repository.mjs');
      const pipelinesRepo = createPipelinesRepository();
      const funnelsRepo = createFunnelsRepository();

      const pgPipeline = await pipelinesRepo.createPipeline(pfTx, {
        name: 'Real PG Sales Pipeline',
        stages: [{ name: 'Lead', probability: 20 }, { name: 'Won', probability: 100 }]
      });
      assert.ok(pgPipeline.id);
      assert.equal(pgPipeline.stages.length, 2);

      const pgFunnel = await funnelsRepo.createFunnel(pfTx, {
        name: 'Real PG Funnel',
        slug: 'real-pg-funnel',
        published: true,
        pages: [{ id: 'p1', slug: 'optin', title: 'Optin' }]
      });
      assert.ok(pgFunnel.id);
      const visitedFunnel = await funnelsRepo.recordVisit(pfTx, pgFunnel.id, 'optin');
      assert.equal(visitedFunnel.visits, 1);

      // Verify cross-tenant isolation under Tenant B
      await pfClient.query('COMMIT');
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      const pfTxB = {
        agencyId: agencyB,
        locationId: locB1,
        actorId: '00000000-0000-4000-8000-000000000002',
        query: (sql, params) => pfClient.query(sql, params)
      };
      assert.equal(await pipelinesRepo.getPipelineById(pfTxB, pgPipeline.id), null, 'Tenant B must not read Tenant A pipeline under real PG RLS');
      assert.equal(await funnelsRepo.getFunnelById(pfTxB, pgFunnel.id), null, 'Tenant B must not read Tenant A funnel under real PG RLS');
      await pfClient.query('ROLLBACK');

      // Cleanup seeded pipeline & funnel under Tenant A
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );
      assert.equal(await pipelinesRepo.deletePipeline(pfTx, pgPipeline.id), true);
      assert.equal(await funnelsRepo.deleteFunnel(pfTx, pgFunnel.id), true);
      await pfClient.query('COMMIT');

      // ─── REAL POSTGRESQL COMMERCE & LEDGER RLS + ATOMICITY CHECK ───
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );
      const { createOrdersRepository, createPaymentsRepository, createInvoicesRepository, createLedgerRepository } = await import('../lib/database.mjs');
      const ordersRepo = createOrdersRepository();
      const paymentsRepo = createPaymentsRepository();
      const invoicesRepo = createInvoicesRepository();
      const ledgerRepo = createLedgerRepository();

      const pgOrder = await ordersRepo.createOrder(pfTx, {
        amountCents: 25000,
        currency: 'USD',
        contactName: 'Real PG Buyer',
        idempotencyKey: 'real_pg_ord_1'
      });
      const pgOrderDup = await ordersRepo.createOrder(pfTx, {
        amountCents: 25000,
        currency: 'USD',
        contactName: 'Real PG Buyer',
        idempotencyKey: 'real_pg_ord_1'
      });
      assert.equal(pgOrderDup.id, pgOrder.id, 'Real PG order idempotency key must deduplicate');

      const pgInvoice = await invoicesRepo.createInvoice(pfTx, {
        orderId: pgOrder.id,
        amountCents: 25000,
        currency: 'USD',
        status: 'draft'
      });
      await invoicesRepo.issueInvoice(pfTx, pgInvoice.id);
      await invoicesRepo.recordPaymentAllocation(pfTx, pgInvoice.id, { paidCents: 25000, paymentMethod: 'card' });

      const pgPayment = await paymentsRepo.createPayment(pfTx, {
        orderId: pgOrder.id,
        invoiceId: pgInvoice.id,
        amountCents: 25000,
        currency: 'USD',
        status: 'pending',
        idempotencyKey: 'real_pg_pay_1'
      });
      await paymentsRepo.recordProviderEvent(pfTx, {
        paymentId: pgPayment.id,
        providerPaymentId: 'pi_real_pg_1',
        providerEventId: 'evt_real_pg_1',
        status: 'succeeded'
      });
      await ledgerRepo.recordTransaction(pfTx, {
        accountType: 'stripe_escrow',
        entryType: 'credit',
        amountCents: 25000,
        referenceType: 'order_payment',
        referenceId: pgOrder.id,
        idempotencyKey: 'real_pg_led_1'
      });
      const ledgerCheck = await ledgerRepo.verifyAccountIntegrity(pfTx, { accountType: 'stripe_escrow' });
      assert.equal(ledgerCheck.valid, true);
      assert.equal(ledgerCheck.balanceCents, 25000);
      await pfClient.query('COMMIT');

      // Verify Tenant B cannot read Tenant A order, invoice, payment, or ledger under real PG RLS
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      assert.equal(await ordersRepo.getOrderById(pfTxB, pgOrder.id), null, 'Tenant B must not read Tenant A order');
      assert.equal(await paymentsRepo.getPaymentById(pfTxB, pgPayment.id), null, 'Tenant B must not read Tenant A payment');
      assert.equal(await invoicesRepo.getInvoiceById(pfTxB, pgInvoice.id), null, 'Tenant B must not read Tenant A invoice');
      const tenantBLedger = await ledgerRepo.verifyAccountIntegrity(pfTxB, { accountType: 'stripe_escrow' });
      assert.equal(tenantBLedger.balanceCents, 0, 'Tenant B ledger must be isolated from Tenant A');
      await pfClient.query('ROLLBACK');

      // ─── REAL POSTGRESQL CONVERSATIONS, MESSAGES & CONSENTS RLS CHECK ───
      const { createConversationsRepository } = await import('../lib/conversations-repository.mjs');
      const { createCommunicationConsentsRepository } = await import('../lib/communication-consents-repository.mjs');
      const conversationsRepo = createConversationsRepository();
      const consentsRepo = createCommunicationConsentsRepository();

      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );

      const pgConv = await conversationsRepo.createConversation(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        contactName: 'Real PG Messaging Contact',
        channel: 'sms',
        subject: 'PG Messaging RLS Test'
      });
      const pgMsg1 = await conversationsRepo.appendMessage(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        conversationId: pgConv.id,
        channel: 'sms',
        direction: 'inbound',
        senderType: 'contact',
        senderName: 'Real PG Messaging Contact',
        body: 'Hello from real PG',
        deliveryStatus: 'delivered',
        provider: 'twilio',
        providerMessageId: 'SM-REAL-PG-1'
      });
      const pgMsgDup = await conversationsRepo.appendMessage(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        conversationId: pgConv.id,
        channel: 'sms',
        direction: 'inbound',
        senderType: 'contact',
        senderName: 'Real PG Messaging Contact',
        body: 'Hello from real PG',
        deliveryStatus: 'delivered',
        provider: 'twilio',
        providerMessageId: 'SM-REAL-PG-1'
      });
      assert.equal(pgMsg1.deduplicated, false);
      assert.equal(pgMsgDup.deduplicated, true, 'Real PG provider_message_id unique index must deduplicate');

      // Consent check for contactIdPg
      const contactIdPg = randomUUID();
      await consentsRepo.recordConsent(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        contactId: contactIdPg,
        channel: 'sms',
        purpose: 'marketing',
        status: 'granted',
        source: 'web_form',
        proofRef: 'pg-form-001'
      });
      await consentsRepo.recordConsent(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        contactId: contactIdPg,
        channel: 'sms',
        purpose: 'marketing',
        status: 'revoked',
        source: 'keyword_opt_out',
        proofRef: 'STOP'
      });
      const smsAllowed = await consentsRepo.isChannelAllowed(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        contactId: contactIdPg,
        channel: 'sms',
        purpose: 'transactional'
      });
      assert.equal(smsAllowed.allowed, false, 'Real PG STOP revocation must block SMS');
      await pfClient.query('COMMIT');

      // Verify Tenant B cannot read Tenant A conversation, messages, or consents under real PG RLS
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      assert.equal(
        await conversationsRepo.getConversation(pfTxB, { agencyId: agencyB, locationId: locB1, id: pgConv.id }),
        null,
        'Tenant B must not read Tenant A conversation'
      );
      const tenantBConsents = await consentsRepo.listConsents(pfTxB, {
        agencyId: agencyB,
        locationId: locB1,
        contactId: contactIdPg
      });
      assert.equal(tenantBConsents.length, 0, 'Tenant B must not read Tenant A communication consents');
      await pfClient.query('ROLLBACK');

      // ─── REAL POSTGRESQL FORMS, TASKS & REVIEWS RLS CHECK ───
      const { createFormsRepository } = await import('../lib/forms-repository.mjs');
      const { createTasksRepository } = await import('../lib/tasks-repository.mjs');
      const { createReviewsRepository } = await import('../lib/reviews-repository.mjs');
      const formsRepo = createFormsRepository();
      const tasksRepo = createTasksRepository();
      const reviewsRepo = createReviewsRepository();

      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );

      const pgForm = await formsRepo.createForm(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        name: 'Real PG Lead Form',
        publicSlug: 'real-pg-lead-form-' + randomUUID().slice(0, 8),
        published: true,
        status: 'published'
      });
      const pgSub1 = await formsRepo.recordSubmission(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        formId: pgForm.id,
        idempotencyKey: 'pg-sub-1',
        answers: { email: 'pg@example.com' }
      });
      const pgSubDup = await formsRepo.recordSubmission(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        formId: pgForm.id,
        idempotencyKey: 'pg-sub-1',
        answers: { email: 'pg@example.com' }
      });
      assert.equal(pgSub1.deduplicated, false);
      assert.equal(pgSubDup.deduplicated, true, 'Real PG form submission idempotency key must deduplicate');

      const pgTask = await tasksRepo.createTask(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        title: 'Real PG Follow Up',
        priority: 'high'
      });
      const pgReview = await reviewsRepo.createReview(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        contactName: 'Real PG Reviewer',
        rating: 5,
        text: 'Excellent!'
      });
      await pfClient.query('COMMIT');

      // Verify Tenant B cannot read Tenant A form, task, or review under real PG RLS
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      assert.equal(await formsRepo.getForm(pfTxB, { agencyId: agencyB, locationId: locB1, id: pgForm.id }), null);
      assert.equal(await tasksRepo.getTask(pfTxB, { agencyId: agencyB, locationId: locB1, id: pgTask.id }), null);
      assert.equal(await reviewsRepo.getReview(pfTxB, { agencyId: agencyB, locationId: locB1, id: pgReview.id }), null);
      await pfClient.query('ROLLBACK');

      // ─── REAL POSTGRESQL PHASE 3 COUPONS, PAYMENT LINKS & DUNNING RLS CHECK ───
      const { createCouponsRepository } = await import('../lib/coupons-repository.mjs');
      const { createPaymentLinksRepository } = await import('../lib/payment-links-repository.mjs');
      const { createDunningRepository } = await import('../lib/dunning-repository.mjs');
      const couponsRepo = createCouponsRepository();
      const paymentLinksRepo = createPaymentLinksRepository();
      const dunningRepo = createDunningRepository();

      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );

      const pgCoupon = await couponsRepo.createCoupon(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        code: 'PG30_' + randomUUID().slice(0, 6),
        discountType: 'percent',
        discountValue: 30,
        maxUses: 1
      });
      await couponsRepo.redeemCoupon(pfTx, { agencyId: agencyA, locationId: locA1, code: pgCoupon.code });
      await assert.rejects(
        () => couponsRepo.redeemCoupon(pfTx, { agencyId: agencyA, locationId: locA1, code: pgCoupon.code }),
        /usage limit/i
      );

      const pgLink = await paymentLinksRepo.createPaymentLink(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        name: 'Real PG Retainer',
        slug: 'pg-retainer-' + randomUUID().slice(0, 6),
        amountCents: 49900
      });
      assert.equal(pgLink.amountCents, 49900);

      const pgDun = await dunningRepo.scheduleRetry(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        invoiceId: pgInvoice.id,
        attemptNumber: 1,
        failureCode: 'insufficient_funds',
        idempotencyKey: 'pg_dun_' + pgInvoice.id
      });
      assert.equal(pgDun.deduplicated, false);
      const pgDunDup = await dunningRepo.scheduleRetry(pfTx, {
        agencyId: agencyA,
        locationId: locA1,
        invoiceId: pgInvoice.id,
        attemptNumber: 1,
        failureCode: 'insufficient_funds',
        idempotencyKey: 'pg_dun_' + pgInvoice.id
      });
      assert.equal(pgDunDup.deduplicated, true);
      await pfClient.query('COMMIT');

      // Verify Tenant B cannot read Tenant A payment links, coupons, or dunning attempts under real PG RLS
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      assert.equal(
        await paymentLinksRepo.getBySlug(pfTxB, { agencyId: agencyB, locationId: locB1, slug: pgLink.slug }),
        null,
        'Tenant B must not read Tenant A payment link'
      );
      const tenantBDunning = await dunningRepo.listAttempts(pfTxB, { agencyId: agencyB, locationId: locB1 });
      assert.equal(tenantBDunning.length, 0, 'Tenant B must not read Tenant A dunning attempts');
      await pfClient.query('ROLLBACK');

      // ─── REAL POSTGRESQL WORKFLOW OPTIMISTIC LOCKING CHECK ───
      const { createWorkflowsRepository } = await import('../lib/workflows-repository.mjs');
      const wfRepo = createWorkflowsRepository();

      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );
      const pgWf = await wfRepo.createWorkflow(pfTx, {
        name: 'Optimistic Lock Test Flow',
        status: 'draft',
        triggerType: 'manual',
        nodes: []
      });
      assert.equal(pgWf.version, 1);

      const pgWfV2 = await wfRepo.updateWorkflow(pfTx, pgWf.id, {
        name: 'Optimistic Lock Test Flow v2',
        expectedVersion: 1
      });
      assert.equal(pgWfV2.version, 2);

      await assert.rejects(
        () => wfRepo.updateWorkflow(pfTx, pgWf.id, { name: 'Stale Update', expectedVersion: 1 }),
        err => err.code === 'VERSION_CONFLICT'
      );
      await pfClient.query('COMMIT');

      // ─── PHASE 5: REAL POSTGRESQL RAG KNOWLEDGE BASE & TENANT RLS CHECK ───
      const { createKnowledgeBaseRepository } = await import('../lib/knowledge-base-repository.mjs');
      const { createAiProviderGateway } = await import('../../platform-core/src/ai/provider-gateway.mjs');
      const { ingestDocumentPipeline, retrieveGroundedKnowledge } = await import('../../platform-core/src/ai/rag.mjs');

      const kbRepo = createKnowledgeBaseRepository();
      const aiGateway = createAiProviderGateway();

      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );
      const ingested = await ingestDocumentPipeline({
        tx: pfTx,
        repository: kbRepo,
        providerGateway: aiGateway,
        title: 'Agency Hours Policy',
        fileType: 'markdown',
        content: '# Business Hours\nWe are closed on Sundays and open Monday to Friday 9am-5pm.'
      });
      assert.equal(ingested.source.status, 'ready');
      assert.ok(ingested.chunksCount >= 1);

      const ragA = await retrieveGroundedKnowledge({
        tx: pfTx,
        repository: kbRepo,
        providerGateway: aiGateway,
        query: 'Are you open on Sundays?'
      });
      assert.equal(ragA.answerable, true);
      assert.ok(ragA.citations.length >= 1);
      assert.equal(ragA.citations[0].sourceId, ingested.source.id);
      await pfClient.query('COMMIT');

      // Cross-tenant isolation under operza_app FORCE RLS: Tenant B must see 0 chunks
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      const ragB = await retrieveGroundedKnowledge({
        tx: pfTxB,
        repository: kbRepo,
        providerGateway: aiGateway,
        query: 'Are you open on Sundays?'
      });
      assert.equal(ragB.answerable, false);
      assert.equal(ragB.citations.length, 0);
      await pfClient.query('ROLLBACK');

      // Deleted document exclusion check under Tenant A
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );
      await kbRepo.softDeleteSource(pfTx, ingested.source.id);
      const ragAfterDelete = await retrieveGroundedKnowledge({
        tx: pfTx,
        repository: kbRepo,
        providerGateway: aiGateway,
        query: 'Are you open on Sundays?'
      });
      assert.equal(ragAfterDelete.answerable, false);
      await pfClient.query('COMMIT');

      // ─── PHASE 6: SITE VERSIONS, CUSTOM DOMAINS & SSL LIFECYCLE UNDER FORCE RLS ───
      const { createSiteVersionsRepository } = await import('../lib/site-versions-repository.mjs');
      const { createCustomDomainsRepository } = await import('../lib/custom-domains-repository.mjs');
      const { createSslProvisioningAdapter } = await import('../../platform-core/src/domains/custom-domains.mjs');
      const versionsRepo = createSiteVersionsRepository();
      const domainsRepo = createCustomDomainsRepository();
      const siteIdA = randomUUID();

      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );
      const v1 = await versionsRepo.publishVersion(pfTx, {
        siteId: siteIdA,
        snapshot: { title: 'V1 Live' },
        seoMeta: { canonical: 'https://portal.phase6-test.example' },
        actorId: 'user-a'
      });
      assert.equal(v1.version_number, 1);
      const draftV2 = await versionsRepo.saveDraft(pfTx, {
        siteId: siteIdA,
        snapshot: { title: 'V2 Draft Unreleased' }
      });
      assert.equal(draftV2.status, 'draft');
      const currentPublished = await versionsRepo.getPublishedVersion(pfTx, siteIdA);
      assert.equal(currentPublished.version_number, 1, 'Draft must not overwrite published version');

      const claimedHost = `portal-${Date.now()}.phase6-test.example`;
      const domA = await domainsRepo.requestDomain(pfTx, { siteId: siteIdA, hostname: claimedHost, isPrimary: true });
      assert.equal(domA.status, 'pending_verification');

      const verifiedDom = await domainsRepo.verifyDomain(pfTx, domA.id, {
        resolveTxt: async () => [[domA.verification_token]]
      });
      assert.equal(verifiedDom.verified, true);
      assert.equal(verifiedDom.domain.status, 'verified');

      const sslRes = await domainsRepo.provisionSsl(pfTx, domA.id, {
        sslAdapter: createSslProvisioningAdapter({
          provider: 'local_tls_fixture',
          issueCertificate: async () => ({ ok: true, issuer: 'Operza Test Fixture', serialNumber: 'sn_pg_1' }),
          verifyHttps: async () => ({ ok: true })
        })
      });
      assert.equal(sslRes.ok, true);
      assert.equal(sslRes.domain.status, 'active');
      await pfClient.query('COMMIT');

      // Cross-tenant duplicate domain claim must be rejected even under Tenant B
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      await assert.rejects(
        () => domainsRepo.requestDomain(pfTxB, { hostname: claimedHost }),
        err => err.code === 'DOMAIN_ALREADY_CLAIMED'
      );
      await pfClient.query('ROLLBACK');

      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      assert.equal(await domainsRepo.getDomainById(pfTxB, domA.id), null, 'Tenant B must not read Tenant A domain');
      assert.equal(await versionsRepo.getPublishedVersion(pfTxB, siteIdA), null, 'Tenant B must not read Tenant A site versions');
      await pfClient.query('ROLLBACK');

      // ─── PHASE 7: SAAS SUBSCRIPTIONS, MARKETPLACE, OAUTH 2.0 & REPORTING UNDER FORCE RLS ───
      const { createSaasSubscriptionsRepository } = await import('../lib/saas-subscriptions-repository.mjs');
      const { createMarketplaceRepository } = await import('../lib/marketplace-repository.mjs');
      const { createOAuthRepository } = await import('../lib/oauth-repository.mjs');
      const { createReportingRepository } = await import('../lib/reporting-repository.mjs');
      const { createHash } = await import('node:crypto');

      const subsRepo = createSaasSubscriptionsRepository();
      const marketRepo = createMarketplaceRepository();
      const oauthRepo = createOAuthRepository();
      const reportRepo = createReportingRepository();

      // Seed & approve marketplace app via privileged pool (platform admin boundary)
      const submittedApp = await marketRepo.submitApp(pool, {
        slug: `slack-pro-${Date.now()}`,
        name: 'Slack Pro Connector',
        publisherId: 'pub_operza',
        requestedScopes: ['contacts:read', 'workflows:trigger']
      });
      await marketRepo.reviewApp(pool, submittedApp.id, { status: 'published', reviewedBy: 'platform_admin_1' });

      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );

      // SaaS subscription & server-side entitlement check
      const subA = await subsRepo.upsertSubscription(pfTx, { planId: 'growth', status: 'active' });
      assert.equal(subA.plan_id, 'growth');
      const entCheck = await subsRepo.assertFeatureEntitled(pfTx, 'customDomains');
      assert.equal(entCheck.entitlements.planId, 'growth');

      // Marketplace install & uninstall
      const instA = await marketRepo.installApp(pfTx, {
        appId: submittedApp.id,
        installedBy: 'user-a',
        grantedScopes: ['contacts:read']
      });
      assert.equal(instA.status, 'installed');
      const uninstalledA = await marketRepo.uninstallApp(pfTx, instA.id);
      assert.equal(uninstalledA.status, 'uninstalled');

      // OAuth 2.0 PKCE + single-use code + replay block + refresh rotation + reuse family revocation
      const { app: oauthApp, clientSecret } = await oauthRepo.createApp(pfTx, {
        name: 'Zapier OAuth Client',
        redirectUris: ['https://app.example.com/oauth/callback'],
        allowedScopes: ['contacts:read'],
        createdBy: 'user-a'
      });
      const verifier = 'phase7_pkce_verifier_secret_value_12345';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const { code: authCode } = await oauthRepo.issueAuthorizationCode(pfTx, {
        clientId: oauthApp.client_id,
        userId: 'user-a',
        redirectUri: 'https://app.example.com/oauth/callback',
        scopes: ['contacts:read'],
        codeChallenge: challenge
      });
      const tok1 = await oauthRepo.exchangeAuthorizationCode(pfTx, {
        clientId: oauthApp.client_id,
        clientSecret,
        code: authCode,
        redirectUri: 'https://app.example.com/oauth/callback',
        codeVerifier: verifier
      });
      assert.ok(tok1.accessToken.startsWith('opz_at_'));
      await assert.rejects(
        () => oauthRepo.exchangeAuthorizationCode(pfTx, {
          clientId: oauthApp.client_id,
          clientSecret,
          code: authCode,
          redirectUri: 'https://app.example.com/oauth/callback',
          codeVerifier: verifier
        }),
        err => err.code === 'AUTH_CODE_REPLAYED'
      );
      const tok2 = await oauthRepo.rotateRefreshToken(pfTx, {
        clientId: oauthApp.client_id,
        clientSecret,
        refreshToken: tok1.refreshToken
      });
      assert.ok(tok2.refreshToken !== tok1.refreshToken);
      await assert.rejects(
        () => oauthRepo.rotateRefreshToken(pfTx, {
          clientId: oauthApp.client_id,
          clientSecret,
          refreshToken: tok1.refreshToken
        }),
        err => err.code === 'REFRESH_TOKEN_REUSED'
      );

      // Consolidated SQL Reporting
      const summaryA = await reportRepo.getWorkspaceSummary(pfTx);
      assert.equal(summaryA.agencyId, agencyA);
      await pfClient.query('COMMIT');

      // Cross-tenant isolation check under Tenant B
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      assert.equal(await subsRepo.getSubscription(pfTxB), null, 'Tenant B must not see Tenant A subscription');
      assert.equal((await marketRepo.listInstallations(pfTxB)).length, 0, 'Tenant B must not see Tenant A installations');
      await pfClient.query('ROLLBACK');

      // ─── PHASE 8: GDPR DATA EXPORT & DELETION UNDER FORCE RLS ───
      const { createGdprRepository } = await import('../lib/gdpr-repository.mjs');
      const { createContactsRepository } = await import('../lib/contacts-repository.mjs');
      const gdprRepo = createGdprRepository();
      const gdprContactsRepo = createContactsRepository();

      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );
      const gdprContact = await gdprContactsRepo.create(pfTx, {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada.gdpr@example.com'
      });
      const exportedA = await gdprRepo.exportSubjectData(pfTx, { subjectEmail: 'ada.gdpr@example.com', requestedBy: 'admin-a' });
      assert.equal(exportedA.records.contacts.length, 1);
      assert.ok(exportedA.manifest.sha256);

      // Legal hold blocks deletion
      await assert.rejects(
        () => gdprRepo.deleteSubjectData(pfTx, { subjectEmail: 'ada.gdpr@example.com', legalHold: true }),
        err => err.code === 'GDPR_LEGAL_HOLD_ACTIVE'
      );

      // Deletion succeeds and is idempotent
      const del1 = await gdprRepo.deleteSubjectData(pfTx, { subjectEmail: 'ada.gdpr@example.com' });
      assert.equal(del1.deletedContacts, 1);
      assert.equal(del1.financialLedgerRetained, true);
      const del2 = await gdprRepo.deleteSubjectData(pfTx, { subjectEmail: 'ada.gdpr@example.com' });
      assert.equal(del2.idempotent, true);
      await pfClient.query('COMMIT');

      // Tenant B cannot export Tenant A subject
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      const exportedB = await gdprRepo.exportSubjectData(pfTxB, { contactId: gdprContact.id });
      assert.equal(exportedB.records.contacts.length, 0);
      await pfClient.query('ROLLBACK');

      // ─── STAGE 1 CRM 2.0: CUSTOMER 360, SAFE MERGE, SMART LISTS & CUSTOM FIELDS UNDER FORCE RLS ───
      const { createCrm2Repository } = await import('../lib/crm-2-repository.mjs');
      const crm2Repo = createCrm2Repository();

      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );
      const cPrimary = await gdprContactsRepo.create(pfTx, {
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@example.com',
        lifecycleStage: 'customer',
        tags: ['vip']
      });
      const cDup = await gdprContactsRepo.create(pfTx, {
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'GRACE@example.com',
        phone: '+14155550199',
        company: 'Compiler Corp',
        tags: ['enterprise']
      });

      const dupGroups = await crm2Repo.findDuplicates(pfTx);
      assert.ok(dupGroups.some((g) => g.reason === 'exact_email'));

      const mergeRes = await crm2Repo.mergeContactsSafely(pfTx, {
        primaryId: cPrimary.id,
        mergeIds: [cDup.id],
        mergedBy: 'admin-a'
      });
      assert.equal(mergeRes.success, true);
      assert.ok(mergeRes.contact.tags.includes('enterprise'));

      // Concurrent/repeated merge of already-merged secondary contact must fail with MERGE_CONFLICT
      await assert.rejects(
        () => crm2Repo.mergeContactsSafely(pfTx, { primaryId: cPrimary.id, mergeIds: [cDup.id] }),
        err => err.code === 'MERGE_CONFLICT'
      );

      const profile360 = await crm2Repo.getCustomer360Profile(pfTx, cPrimary.id);
      assert.equal(profile360.contact.id, cPrimary.id);
      assert.ok(profile360.timeline.total >= 1);

      const cfDef = await crm2Repo.createCustomFieldDef(pfTx, {
        fieldKey: 'arr_tier',
        label: 'ARR Tier',
        fieldType: 'select',
        options: ['starter', 'enterprise']
      });
      assert.equal(cfDef.field_key, 'arr_tier');

      const smartList = await crm2Repo.createSmartList(pfTx, {
        name: 'VIP Customers',
        filterAst: { op: 'and', rules: [{ field: 'tags', operator: 'contains', value: 'vip' }] },
        createdBy: 'admin-a'
      });
      const evalRes = await crm2Repo.evaluateSmartList(pfTx, smartList.id);
      assert.ok(evalRes.total >= 1);
      await pfClient.query('COMMIT');

      // Cross-tenant isolation check under Tenant B
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      assert.equal(await crm2Repo.getCustomer360Profile(pfTxB, cPrimary.id), null, 'Tenant B must not read Tenant A Customer 360');
      assert.equal((await crm2Repo.listSmartLists(pfTxB)).length, 0, 'Tenant B must not read Tenant A Smart Lists');
      await pfClient.query('ROLLBACK');

      // ── 13. Workflow Builder 2.0 (Immutable Versions, Concurrency, Schedules, Logs, FORCE RLS)
      const { createWorkflows2Repository } = await import('../lib/workflows-2-repository.mjs');
      const wf2Repo = createWorkflows2Repository();
      const wf2Id = '22222222-2222-4222-8222-222222222222';
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );
      await pfClient.query(
        `INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, trigger_config, nodes, graph_json, version)
         VALUES ($1, $2, $3, 'WF2 Onboarding', 'draft', 'contact_created', '{}'::jsonb, '[]'::jsonb, '{"nodes":[{"id":"n1","kind":"tag","label":"Tag VIP","config":{"tag":"vip"}}],"edges":[{"id":"e1","source":"trigger","target":"n1"}]}'::jsonb, 1)`,
        [wf2Id, agencyA, locA1]
      );
      const pub1 = await wf2Repo.publishWorkflowVersion(pfTx, {
        workflowId: wf2Id,
        expectedVersion: 1,
        publishedBy: 'admin-a',
        changeSummary: 'Initial publish'
      });
      assert.equal(pub1.version.versionNumber, 1);

      // Optimistic concurrency conflict check
      await assert.rejects(
        () => wf2Repo.publishWorkflowVersion(pfTx, { workflowId: wf2Id, expectedVersion: 99 }),
        (err) => err?.code === 'VERSION_CONFLICT'
      );

      const pub2 = await wf2Repo.publishWorkflowVersion(pfTx, {
        workflowId: wf2Id,
        expectedVersion: 1,
        publishedBy: 'admin-a',
        changeSummary: 'Second publish'
      });
      assert.equal(pub2.version.versionNumber, 2);

      const rolled = await wf2Repo.rollbackWorkflowVersion(pfTx, {
        workflowId: wf2Id,
        targetVersionNumber: 1,
        actorId: 'admin-a'
      });
      assert.equal(rolled.version.versionNumber, 3);
      const versions = await wf2Repo.listWorkflowVersions(pfTx, wf2Id);
      assert.equal(versions.length, 3);

      const sched = await wf2Repo.createSchedule(pfTx, {
        workflowId: wf2Id,
        scheduleType: 'cron',
        timezone: 'America/New_York',
        cronExpression: '15 9 * * *',
        catchupPolicy: 'skip'
      });
      assert.equal(sched.timezone, 'America/New_York');
      assert.ok(sched.nextRunAt);

      const wf2Metrics = await wf2Repo.getWorkflowObservabilityMetrics(pfTx);
      assert.equal(typeof wf2Metrics.totalExecutions, 'number');
      await pfClient.query('COMMIT');

      // Tenant B must not see Tenant A versions or schedules under FORCE RLS
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      assert.equal((await wf2Repo.listWorkflowVersions(pfTxB, wf2Id)).length, 0, 'Tenant B must not read Tenant A workflow_versions');
      assert.equal((await wf2Repo.listSchedules(pfTxB, wf2Id)).length, 0, 'Tenant B must not read Tenant A workflow_schedules');
      await pfClient.query('ROLLBACK');

      // ── 14. Integrations Hub 2.0 (Connections, Webhook Deduplication, Sync Jobs/Conflicts, FORCE RLS)
      const { createIntegrations2Repository } = await import('../lib/integrations-2-repository.mjs');
      const int2Repo = createIntegrations2Repository();
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );
      const conn = await int2Repo.createConnection(pfTx, {
        connectorId: 'stripe',
        provider: 'payments.stripe',
        accountLabel: 'Stripe Sandbox A',
        authStrategy: 'api_key',
        status: 'active',
        readinessLevel: 'sandbox_verified',
        vaultSecretRef: 'vault:ag-a:stripe:1',
        grantedScopes: ['commerce:read', 'commerce:write'],
        createdBy: 'admin-a'
      });
      assert.equal(conn.hasSecretRef, true);
      assert.equal('vault_secret_ref' in conn, false);

      const ev1 = await int2Repo.recordWebhookEvent(pfTx, {
        connectionId: conn.id,
        provider: 'payments.stripe',
        providerEventId: 'evt_dup_1',
        eventType: 'payment.succeeded',
        payload: { amountCents: 2500 }
      });
      assert.equal(ev1.deduplicated, false);
      const ev2 = await int2Repo.recordWebhookEvent(pfTx, {
        connectionId: conn.id,
        provider: 'payments.stripe',
        providerEventId: 'evt_dup_1',
        eventType: 'payment.succeeded',
        payload: { amountCents: 2500 }
      });
      assert.equal(ev2.deduplicated, true);

      const syncJob = await int2Repo.createSyncJob(pfTx, {
        connectionId: conn.id,
        entityType: 'contacts',
        direction: 'two_way',
        conflictPolicy: 'manual_queue'
      });
      await int2Repo.createSyncConflict(pfTx, {
        syncJobId: syncJob.id,
        localRecordId: 'c1',
        externalRecordId: 'ext1',
        localPayload: { email: 'a@test.com' },
        externalPayload: { email: 'b@test.com' }
      });
      const intMetrics = await int2Repo.getIntegrationMetrics(pfTx);
      assert.equal(intMetrics.connections.active, 1);
      assert.equal(intMetrics.openSyncConflicts, 1);

      const disc = await int2Repo.updateConnectionStatus(pfTx, conn.id, { status: 'disconnected' });
      assert.equal(disc.status, 'disconnected');
      assert.ok(disc.revokedAt);
      await pfClient.query('COMMIT');

      // Cross-tenant FORCE RLS check under Tenant B
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      assert.equal((await int2Repo.listConnections(pfTxB)).length, 0, 'Tenant B must not read Tenant A integration_connections');
      assert.equal((await int2Repo.listWebhookEvents(pfTxB)).length, 0, 'Tenant B must not read Tenant A integration_webhook_events');
      assert.equal((await int2Repo.listSyncConflicts(pfTxB)).length, 0, 'Tenant B must not read Tenant A integration_sync_conflicts');
      await pfClient.query('ROLLBACK');

      // ── 15. AI Automation & Agents 2.0 (Agents, Plans, User-Isolated Memory, Delegations, Evals, FORCE RLS)
      const { createAi2Repository } = await import('../lib/ai-2-repository.mjs');
      const ai2Repo = createAi2Repository();
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );
      const agent = await ai2Repo.createAgent(pfTx, {
        name: 'CRM Ops Specialist',
        persona: 'executive',
        model: 'operza-deterministic-v1',
        allowedTools: ['search_contacts']
      });
      const runWithPlan = await ai2Repo.createRunWithPlan(pfTx, {
        agentId: agent.id,
        userId: 'user-a1',
        objective: 'Find VIP contacts',
        steps: [{ action: 'search', tool: 'search_contacts' }],
        validated: true
      });
      assert.equal(runWithPlan.plan.validated, true);

      await ai2Repo.createMemory(pfTx, {
        scope: 'user',
        userId: 'user-a1',
        agentId: agent.id,
        memoryKey: 'style',
        content: 'Prefer bullet points'
      });
      await ai2Repo.createMemory(pfTx, {
        scope: 'agency',
        agentId: agent.id,
        memoryKey: 'policy',
        content: 'Always verify consent before messaging'
      });
      assert.equal((await ai2Repo.listMemories(pfTx, { userId: 'user-a1' })).length, 2);
      assert.equal((await ai2Repo.listMemories(pfTx, { userId: 'user-a2' })).length, 1);

      const delegation = await ai2Repo.createDelegation(pfTx, {
        parentRunId: runWithPlan.run.id,
        parentAgentId: agent.id,
        specialistType: 'research',
        depth: 1
      });
      assert.equal(delegation.depth, 1);
      await pfClient.query('COMMIT');

      // Cross-tenant FORCE RLS check under Tenant B
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      assert.equal((await ai2Repo.listAgents(pfTxB)).length, 0, 'Tenant B must not read Tenant A ai_agents');
      assert.equal((await ai2Repo.listRuns(pfTxB)).length, 0, 'Tenant B must not read Tenant A ai_runs');
      assert.equal((await ai2Repo.listMemories(pfTxB, { userId: 'user-a1' })).length, 0, 'Tenant B must not read Tenant A ai_agent_memories');
      await pfClient.query('ROLLBACK');

      // ── 16. Marketplace & Developer Ecosystem 2.0 (Publishers, Releases, Upgrades, Verified Reviews, FORCE RLS)
      const { createMarketplace2Repository } = await import('../lib/marketplace-2-repository.mjs');
      const m1Repo = createMarketplaceRepository();
      const m2Repo = createMarketplace2Repository();

      // Publisher & Platform-Admin catalog operations run on privileged pool (not tenant operza_app role)
      const pub = await m2Repo.createPublisher(pool, {
        ownerUserId: 'pub-owner-1',
        displayName: 'Acme Dev Studio',
        supportEmail: 'support@acme.example.com'
      });
      const draftApp = await m2Repo.createDraftApp(pool, {
        publisherId: pub.id,
        ownerUserId: 'pub-owner-1',
        manifest: {
          slug: 'acme-sync-v2',
          name: 'Acme Sync V2',
          appType: 'external_connector',
          version: '1.0.0',
          pricingModel: 'free',
          requestedScopes: ['contacts:read']
        }
      });
      await m2Repo.submitAppForReview(pool, { appId: draftApp.id, ownerUserId: 'pub-owner-1' });
      await m2Repo.adminTransitionApp(pool, { appId: draftApp.id, toStatus: 'under_review', actorId: 'platform-admin-1' });
      await m2Repo.adminTransitionApp(pool, { appId: draftApp.id, toStatus: 'approved', actorId: 'platform-admin-1' });
      await m2Repo.adminTransitionApp(pool, { appId: draftApp.id, toStatus: 'published', actorId: 'platform-admin-1' });

      // Tenant A installation, verified review, and scope-upgrade consent under operza_app + FORCE RLS
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );
      const inst = await m1Repo.installApp(pfTx, {
        appId: draftApp.id,
        installedBy: 'agency-user-1',
        grantedScopes: ['contacts:read']
      });
      assert.equal(inst.status, 'installed');

      // Verified installation review succeeds for agency-user-1, but self-review fails for pub-owner-1
      await assert.rejects(
        () => m2Repo.submitReview(pfTx, { appId: draftApp.id, reviewerUserId: 'pub-owner-1', rating: 5, body: 'Self!' }),
        err => err?.code === 'SELF_REVIEW_FORBIDDEN'
      );
      const rev = await m2Repo.submitReview(pfTx, { appId: draftApp.id, reviewerUserId: 'agency-user-1', rating: 5, body: 'Solid connector' });
      assert.equal(rev.verified_installation, true);

      // Submit v1.1.0 with new scope -> requires renewed consent
      await m2Repo.submitNewVersion(pool, {
        appId: draftApp.id,
        ownerUserId: 'pub-owner-1',
        manifest: {
          name: 'Acme Sync V2',
          appType: 'external_connector',
          version: '1.1.0',
          requestedScopes: ['contacts:read', 'communications:send']
        }
      });
      await pool.query(`UPDATE marketplace_app_releases SET security_review_status = 'approved' WHERE app_id = $1 AND version = '1.1.0'`, [draftApp.id]);
      await assert.rejects(
        () => m2Repo.upgradeInstallation(pfTx, { installationId: inst.id, targetVersion: '1.1.0', consentUpgraded: false }),
        err => err?.code === 'PERMISSION_UPGRADE_CONSENT_REQUIRED'
      );
      const upgraded = await m2Repo.upgradeInstallation(pfTx, { installationId: inst.id, targetVersion: '1.1.0', consentUpgraded: true });
      assert.equal(upgraded.installed_version, '1.1.0');

      // Publisher isolation check
      await assert.rejects(
        () => m2Repo.getPublisherAnalytics(pool, { publisherId: pub.id, ownerUserId: 'other-pub' }),
        err => err?.code === 'PUBLISHER_FORBIDDEN'
      );
      await pfClient.query('COMMIT');

      // Cross-tenant FORCE RLS check under Tenant B
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      assert.equal((await m1Repo.listInstallations(pfTxB)).length, 0, 'Tenant B must not read Tenant A marketplace_installations');
      const revB = await pfTxB.query(`SELECT * FROM marketplace_app_reviews WHERE app_id = $1`, [draftApp.id]);
      assert.equal(revB.rows.length, 0, 'Tenant B must not read Tenant A tenant-scoped marketplace_app_reviews');
      await pfClient.query('ROLLBACK');

      // ── 17. Analytics & BI 2.0 (Executive Overview, Custom Query, Saved Dashboards/Reports, Events Deduplication, FORCE RLS)
      const { createAnalytics2Repository } = await import('../lib/analytics-2-repository.mjs');
      const a2Repo = createAnalytics2Repository();
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyA, locA1, '00000000-0000-4000-8000-000000000001']
      );
      const overview = await a2Repo.getExecutiveOverview(pfTx);
      assert.equal(overview.freshness, 'real_time_source_query');
      assert.ok(overview.crm.totalContacts >= 1);

      const custom = await a2Repo.runCustomReport(pfTx, { dataSource: 'opportunities', dimensions: ['status'], measures: ['count'] });
      assert.ok(Array.isArray(custom.rows));

      await a2Repo.createSavedDashboard(pfTx, { ownerUserId: 'user-a1', visibility: 'private', title: 'Private Dash' });
      await a2Repo.createSavedDashboard(pfTx, { ownerUserId: 'user-a1', visibility: 'agency', title: 'Shared Dash' });
      assert.equal((await a2Repo.listSavedDashboards(pfTx, { userId: 'user-a1' })).length, 2);
      assert.equal((await a2Repo.listSavedDashboards(pfTx, { userId: 'user-a2' })).length, 1);

      const savedRep = await a2Repo.createSavedReport(pfTx, { ownerUserId: 'user-a1', title: 'Opp Summary', dataSource: 'opportunities', dimensions: ['status'], measures: ['count'] });
      await a2Repo.createScheduledReport(pfTx, { reportId: savedRep.id, frequency: 'weekly', timezone: 'America/New_York', recipients: ['ops@acme.test'] });
      await a2Repo.createThresholdAlert(pfTx, { metricId: 'workflow.executions.success_rate', operator: 'lt', thresholdValue: 0.9 });

      const aEv1 = await a2Repo.recordAnalyticsEvent(pfTx, { eventType: 'contact.created', sourceModule: 'crm', deduplicationKey: 'crm-ev-1' });
      assert.equal(aEv1.deduplicated, false);
      const aEv2 = await a2Repo.recordAnalyticsEvent(pfTx, { eventType: 'contact.created', sourceModule: 'crm', deduplicationKey: 'crm-ev-1' });
      assert.equal(aEv2.deduplicated, true);
      await pfClient.query('COMMIT');

      // Cross-tenant FORCE RLS check under Tenant B
      await pfClient.query('BEGIN');
      await pfClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
        [agencyB, locB1, '00000000-0000-4000-8000-000000000002']
      );
      assert.equal((await a2Repo.listSavedDashboards(pfTxB, { userId: 'user-a1' })).length, 0, 'Tenant B must not read Tenant A dashboards');
      assert.equal((await a2Repo.listSavedReports(pfTxB, { userId: 'user-a1' })).length, 0, 'Tenant B must not read Tenant A reports');
      await pfClient.query('ROLLBACK');
    } finally {
      await pfClient.query('ROLLBACK').catch(() => {});
      await pfClient.query('RESET ROLE').catch(() => {});
      pfClient.release();
    }

    console.log('[REAL-PG-TEST] All real PostgreSQL RLS and least-privilege checks passed successfully.');
  } finally {
    await pool.end();
  }
});
