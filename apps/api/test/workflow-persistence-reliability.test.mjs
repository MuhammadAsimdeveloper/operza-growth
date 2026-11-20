import test from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { IsolatedTestPostgres } from '../../../packages/db/lib/test-postgres-server.mjs';
import { persistInitialWorkflowExecution, persistCompletedWorkflowExecution } from '../workflow-persistence.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

test('Workflow Execution Persistence Reliability & Connection Error Handling', async (t) => {

  await t.test('Scenario 1: pgPool.connect() rejects during initial persistence', async () => {
    let connectCalled = false;
    const fakePool = {
      connect: async () => {
        connectCalled = true;
        throw new Error('Connection refused to PostgreSQL socket');
      }
    };

    // In authoritative mode, must fail closed with WORKFLOW_EXECUTION_PERSIST_FAILED
    await assert.rejects(
      async () => {
        await persistInitialWorkflowExecution({
          pgPool: fakePool,
          agencyId: randomUUID(),
          locationId: randomUUID(),
          execution: { id: randomUUID(), status: 'queued' },
          flow: { id: randomUUID() },
          isStagingOrProd: true
        });
      },
      (err) => {
        assert.equal(err.code, 'WORKFLOW_EXECUTION_PERSIST_FAILED');
        assert.match(err.message, /Connection refused/);
        return true;
      }
    );

    assert.equal(connectCalled, true);
  });

  await t.test('Scenario 2: pgPool.connect() rejects during completion persistence', async () => {
    let connectCalled = false;
    const fakePool = {
      connect: async () => {
        connectCalled = true;
        throw new Error('Connection timeout on pool acquisition');
      }
    };

    await assert.rejects(
      async () => {
        await persistCompletedWorkflowExecution({
          pgPool: fakePool,
          agencyId: randomUUID(),
          locationId: randomUUID(),
          execution: { id: randomUUID(), status: 'completed', steps: [] },
          flow: { id: randomUUID() },
          platformDbEnabled: true
        });
      },
      (err) => {
        assert.equal(err.code, 'WORKFLOW_EXECUTION_UPDATE_FAILED');
        assert.match(err.message, /Connection timeout/);
        return true;
      }
    );

    assert.equal(connectCalled, true);
  });

  await t.test('Scenario 3: query failure after client acquired', async () => {
    let released = false;
    let rolledBack = false;

    const fakeClient = {
      query: async (sql) => {
        if (typeof sql === 'string' && sql.trim() === 'BEGIN') return {};
        if (typeof sql === 'string' && sql.includes('set_config')) return {};
        if (typeof sql === 'string' && sql.includes('INSERT INTO workflow_executions')) {
          throw new Error('relation "workflow_executions" does not exist');
        }
        if (typeof sql === 'string' && sql.trim() === 'ROLLBACK') {
          rolledBack = true;
          return {};
        }
        return {};
      },
      release: () => {
        released = true;
      }
    };

    const fakePool = {
      connect: async () => fakeClient
    };

    await assert.rejects(
      async () => {
        await persistInitialWorkflowExecution({
          pgPool: fakePool,
          agencyId: randomUUID(),
          locationId: randomUUID(),
          execution: { id: randomUUID(), status: 'running' },
          flow: { id: randomUUID() },
          platformDbEnabled: true
        });
      },
      (err) => {
        assert.equal(err.code, 'WORKFLOW_EXECUTION_PERSIST_FAILED');
        return true;
      }
    );

    assert.equal(rolledBack, true, 'Transaction must be rolled back on query failure');
    assert.equal(released, true, 'Client must be released even on query failure');
  });

  await t.test('Scenario 4: rollback called exactly once after failed transaction and rollback error handled', async () => {
    let rollbackCalls = 0;
    let released = false;

    const fakeClient = {
      query: async (sql) => {
        if (typeof sql === 'string' && sql.trim() === 'BEGIN') return {};
        if (typeof sql === 'string' && sql.includes('set_config')) return {};
        if (typeof sql === 'string' && sql.includes('UPDATE workflow_executions')) {
          throw new Error('deadlock detected');
        }
        if (typeof sql === 'string' && sql.trim() === 'ROLLBACK') {
          rollbackCalls++;
          throw new Error('server closed connection unexpectedly during rollback');
        }
        return {};
      },
      release: () => {
        released = true;
      }
    };

    const fakePool = {
      connect: async () => fakeClient
    };

    // Even if ROLLBACK query fails, root error must be preserved and client must still be released
    await assert.rejects(
      async () => {
        await persistCompletedWorkflowExecution({
          pgPool: fakePool,
          agencyId: randomUUID(),
          locationId: randomUUID(),
          execution: { id: randomUUID(), status: 'failed', steps: [] },
          flow: { id: randomUUID() },
          isStagingOrProd: true
        });
      },
      (err) => {
        assert.equal(err.code, 'WORKFLOW_EXECUTION_UPDATE_FAILED');
        assert.match(err.message, /deadlock detected/);
        return true;
      }
    );

    assert.equal(rollbackCalls, 1, 'ROLLBACK must be called on failure');
    assert.equal(released, true, 'Client must be released in finally block');
  });

  await t.test('Scenario 5: client release verified on both success and failure', async () => {
    // 5a. Success release verification
    let successReleased = false;
    let committed = false;
    const fakeClientSuccess = {
      query: async (sql) => {
        if (typeof sql === 'string' && sql.trim() === 'COMMIT') {
          committed = true;
        }
        return { rows: [{ id: 'test_123' }] };
      },
      release: () => {
        successReleased = true;
      }
    };

    const result = await persistInitialWorkflowExecution({
      pgPool: { connect: async () => fakeClientSuccess },
      agencyId: randomUUID(),
      locationId: randomUUID(),
      execution: { id: randomUUID(), status: 'running' },
      flow: { id: randomUUID() },
      platformDbEnabled: true
    });

    assert.equal(committed, true);
    assert.equal(successReleased, true, 'Client must be released on success');
    assert.ok(result);

    // 5b. Failure release verification
    let failureReleased = false;
    const fakeClientFailure = {
      query: async (sql) => {
        if (typeof sql === 'string' && sql.trim() === 'BEGIN') return {};
        throw new Error('Connection lost');
      },
      release: () => {
        failureReleased = true;
      }
    };

    await assert.rejects(async () => {
      await persistCompletedWorkflowExecution({
        pgPool: { connect: async () => fakeClientFailure },
        agencyId: randomUUID(),
        locationId: randomUUID(),
        execution: { id: randomUUID(), status: 'completed' },
        flow: { id: randomUUID() },
        platformDbEnabled: true
      });
    });

    assert.equal(failureReleased, true, 'Client must be released on failure');
  });

  await t.test('Scenario 6: authoritative mode failure behavior & validation', async () => {
    // Missing locationId in authoritative mode throws WORKFLOW_EXECUTION_LOCATION_REQUIRED
    await assert.rejects(
      async () => {
        await persistInitialWorkflowExecution({
          pgPool: { connect: async () => ({ query: async () => {}, release: () => {} }) },
          agencyId: randomUUID(),
          locationId: null, // missing location
          execution: { id: randomUUID(), status: 'running' },
          flow: { id: randomUUID() },
          platformDbEnabled: true
        });
      },
      (err) => {
        assert.equal(err.code, 'WORKFLOW_EXECUTION_LOCATION_REQUIRED');
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await persistCompletedWorkflowExecution({
          pgPool: { connect: async () => ({ query: async () => {}, release: () => {} }) },
          agencyId: null, // missing agency
          locationId: randomUUID(),
          execution: { id: randomUUID(), status: 'completed' },
          flow: { id: randomUUID() },
          isStagingOrProd: true
        });
      },
      (err) => {
        assert.equal(err.code, 'WORKFLOW_EXECUTION_LOCATION_REQUIRED');
        return true;
      }
    );
  });

  await t.test('Scenario 7: development/test fallback behavior', async () => {
    // In dev mode (neither staging/prod nor platformDbEnabled), failures log warning and return null
    const failingPool = {
      connect: async () => {
        throw new Error('Local dev DB offline');
      }
    };

    const res1 = await persistInitialWorkflowExecution({
      pgPool: failingPool,
      agencyId: randomUUID(),
      locationId: randomUUID(),
      execution: { id: randomUUID(), status: 'running' },
      flow: { id: randomUUID() },
      isStagingOrProd: false,
      platformDbEnabled: false
    });
    assert.equal(res1, null, 'Must return null and not throw in dev mode');

    const res2 = await persistCompletedWorkflowExecution({
      pgPool: failingPool,
      agencyId: randomUUID(),
      locationId: randomUUID(),
      execution: { id: randomUUID(), status: 'completed' },
      flow: { id: randomUUID() },
      isStagingOrProd: false,
      platformDbEnabled: false
    });
    assert.equal(res2, null, 'Must return null and not throw in dev mode');

    // Missing location in dev mode returns null without throwing
    const res3 = await persistInitialWorkflowExecution({
      pgPool: failingPool,
      agencyId: randomUUID(),
      locationId: null,
      execution: { id: randomUUID(), status: 'running' },
      flow: { id: randomUUID() },
      isStagingOrProd: false,
      platformDbEnabled: false
    });
    assert.equal(res3, null);
  });

  await t.test('Scenario 8: Real PostgreSQL composite key & tenant isolation under migration least-privilege', async () => {
    const pgServer = new IsolatedTestPostgres({ port: 0, dbName: 'operza_wf_persist_test' });
    const dbUrl = await pgServer.start();

    const parsedUrl = new URL(dbUrl);
    const dbName = parsedUrl.pathname.replace(/^\//, '');

    console.log(`[WORKFLOW-PERSIST-TEST] Scenario 8 executing against real PostgreSQL at: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);

    const { default: pg } = await import('pg');
    const adminPool = new pg.Pool({ connectionString: dbUrl, max: 10 });

    try {
      // 1. Setup least-privilege roles without artificial superuser or bypassrls grants
      await adminPool.query(`
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
        GRANT ALL ON DATABASE "${dbName}" TO operza_migrator;
        GRANT CONNECT ON DATABASE "${dbName}" TO operza_app, operza_worker;
        GRANT USAGE, CREATE ON SCHEMA public TO operza_migrator, operza_auth_definer;
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

      const migratorUrl = new URL(dbUrl);
      migratorUrl.username = 'operza_migrator';
      migratorUrl.password = 'operza_migrator_secret';
      const migratorPool = new pg.Pool({ connectionString: migratorUrl.toString(), max: 5 });

      const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
      for (const file of files) {
        const sql = await readFile(path.join(migrationsDir, file), 'utf8');
        await migratorPool.query(sql);
      }
      await migratorPool.end();

      // Verify operza_app role retains NOSUPERUSER and NOBYPASSRLS
      const roleCheck = await adminPool.query(`
        SELECT rolname, rolsuper, rolbypassrls 
        FROM pg_roles 
        WHERE rolname = 'operza_app'
      `);
      assert.equal(roleCheck.rows[0].rolsuper, false, 'operza_app must not be superuser');
      assert.equal(roleCheck.rows[0].rolbypassrls, false, 'operza_app must not have BYPASSRLS');

      // Connect as genuine least-privilege operza_app role
      const appUrl = new URL(dbUrl);
      appUrl.username = 'operza_app';
      appUrl.password = 'operza_app_secret';
      const appPool = new pg.Pool({ connectionString: appUrl.toString(), max: 10 });

      try {
        const agencyA = randomUUID();
        const agencyB = randomUUID();
        const locationA1 = randomUUID();
        const locationA2 = randomUUID();
        const locationB1 = randomUUID();
        const workflowId = randomUUID();
        const executionId = randomUUID();

        // Seed agencies, locations and workflow definition using adminPool
        await adminPool.query(
          `INSERT INTO agencies (id, name, slug) VALUES 
           ($1, 'Agency A', 'agency-a-${Date.now()}'), 
           ($2, 'Agency B', 'agency-b-${Date.now()}')`,
          [agencyA, agencyB]
        );
        await adminPool.query(
          `INSERT INTO locations (id, agency_id, name, status, created_at) VALUES 
           ($1, $2, 'Location A1', 'active', now()),
           ($3, $2, 'Location A2', 'active', now()),
           ($4, $5, 'Location B1', 'active', now())`,
          [locationA1, agencyA, locationA2, locationB1, agencyB]
        );
        await adminPool.query(
          `INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, trigger_config, nodes, version) VALUES
           ($1, $2, $3, 'Test Flow', 'published', 'manual', '{}'::jsonb, '[]'::jsonb, 1)`,
          [workflowId, agencyA, locationA1]
        );

        // 8a. Initial persist for Location A1 via operza_app
        const initialRes = await persistInitialWorkflowExecution({
          pgPool: appPool,
          agencyId: agencyA,
          locationId: locationA1,
          execution: { id: executionId, status: 'running' },
          flow: { id: workflowId },
          triggerContext: { source: 'unit_test' },
          platformDbEnabled: true
        });
        assert.ok(initialRes, 'Initial execution record must be inserted');
        assert.equal(initialRes.id, executionId);
        assert.equal(initialRes.agency_id, agencyA);
        assert.equal(initialRes.location_id, locationA1);
        assert.equal(initialRes.status, 'running');

        // 8b. Attempt update with wrong location (locationA2) -> must NOT update locationA1's execution
        const crossLocationUpdate = await persistCompletedWorkflowExecution({
          pgPool: appPool,
          agencyId: agencyA,
          locationId: locationA2, // Different location in same agency
          execution: { id: executionId, status: 'completed', steps: [] },
          flow: { id: workflowId },
          platformDbEnabled: true
        });
        assert.equal(crossLocationUpdate, null, 'Cross-location update must affect 0 rows and return null');

        // Verify locationA1 record is still 'running'
        const checkClient = await appPool.connect();
        try {
          await checkClient.query('BEGIN');
          await checkClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [agencyA, locationA1]);
          const checkRes = await checkClient.query('SELECT status FROM workflow_executions WHERE id = $1', [executionId]);
          assert.equal(checkRes.rows[0].status, 'running', 'Record status must remain unchanged after cross-location attempt');
          await checkClient.query('COMMIT');
        } finally {
          checkClient.release();
        }

        // 8c. Attempt update with wrong agency (agencyB, locationB1) -> must NOT update
        const crossAgencyUpdate = await persistCompletedWorkflowExecution({
          pgPool: appPool,
          agencyId: agencyB,
          locationId: locationB1,
          execution: { id: executionId, status: 'completed', steps: [] },
          flow: { id: workflowId },
          platformDbEnabled: true
        });
        assert.equal(crossAgencyUpdate, null, 'Cross-agency update must affect 0 rows and return null');

        // 8d. Attempt update for non-existent execution ID -> returns null (never reports false success)
        const nonExistentUpdate = await persistCompletedWorkflowExecution({
          pgPool: appPool,
          agencyId: agencyA,
          locationId: locationA1,
          execution: { id: randomUUID(), status: 'completed', steps: [] },
          flow: { id: workflowId },
          platformDbEnabled: true
        });
        assert.equal(nonExistentUpdate, null, 'Non-existent execution update must return null');

        // 8e. Legitimate update for Location A1
        const completedRes = await persistCompletedWorkflowExecution({
          pgPool: appPool,
          agencyId: agencyA,
          locationId: locationA1,
          execution: { id: executionId, status: 'completed', steps: [{ stepId: 'step_1', status: 'done' }] },
          flow: { id: workflowId },
          platformDbEnabled: true
        });
        assert.ok(completedRes, 'Legitimate update must succeed');
        assert.equal(completedRes.status, 'completed');
        assert.equal(completedRes.agency_id, agencyA);
        assert.equal(completedRes.location_id, locationA1);
      } finally {
        await appPool.end();
      }
    } finally {
      await adminPool.end();
      await pgServer.stop();
    }
  });

  await t.test('Scenario 9: Tenant identity consistency & conflict rejection', async () => {
    const locA = randomUUID();
    const locB = randomUUID();
    const agencyA = randomUUID();
    const agencyB = randomUUID();

    const fakePool = {
      connect: async () => ({ query: async () => {}, release: () => {} })
    };

    // 9a. Initial persistence with conflicting locationId throws TENANT_CONTEXT_MISMATCH in authoritative mode
    await assert.rejects(
      async () => {
        await persistInitialWorkflowExecution({
          pgPool: fakePool,
          agencyId: agencyA,
          locationId: locA,
          execution: { id: randomUUID(), agencyId: agencyA, locationId: locB, status: 'running' },
          flow: { id: randomUUID() },
          platformDbEnabled: true
        });
      },
      (err) => {
        assert.equal(err.code, 'TENANT_CONTEXT_MISMATCH');
        assert.match(err.message, /Tenant location mismatch/);
        return true;
      }
    );

    // 9b. Initial persistence with conflicting agencyId throws TENANT_CONTEXT_MISMATCH in authoritative mode
    await assert.rejects(
      async () => {
        await persistInitialWorkflowExecution({
          pgPool: fakePool,
          agencyId: agencyA,
          locationId: locA,
          execution: { id: randomUUID(), agencyId: agencyB, locationId: locA, status: 'running' },
          flow: { id: randomUUID() },
          platformDbEnabled: true
        });
      },
      (err) => {
        assert.equal(err.code, 'TENANT_CONTEXT_MISMATCH');
        assert.match(err.message, /Tenant agency mismatch/);
        return true;
      }
    );

    // 9c. Completion persistence with conflicting locationId throws TENANT_CONTEXT_MISMATCH in authoritative mode
    await assert.rejects(
      async () => {
        await persistCompletedWorkflowExecution({
          pgPool: fakePool,
          agencyId: agencyA,
          locationId: locA,
          execution: { id: randomUUID(), agencyId: agencyA, locationId: locB, status: 'completed' },
          flow: { id: randomUUID() },
          isStagingOrProd: true
        });
      },
      (err) => {
        assert.equal(err.code, 'TENANT_CONTEXT_MISMATCH');
        assert.match(err.message, /Tenant location mismatch/);
        return true;
      }
    );

    // 9d. Completion persistence with conflicting agencyId throws TENANT_CONTEXT_MISMATCH in authoritative mode
    await assert.rejects(
      async () => {
        await persistCompletedWorkflowExecution({
          pgPool: fakePool,
          agencyId: agencyA,
          locationId: locA,
          execution: { id: randomUUID(), agencyId: agencyB, locationId: locA, status: 'completed' },
          flow: { id: randomUUID() },
          isStagingOrProd: true
        });
      },
      (err) => {
        assert.equal(err.code, 'TENANT_CONTEXT_MISMATCH');
        assert.match(err.message, /Tenant agency mismatch/);
        return true;
      }
    );

    // 9e. Development mode fallback: returns null and logs warning without throwing
    const resDevLocationConflict = await persistInitialWorkflowExecution({
      pgPool: fakePool,
      agencyId: agencyA,
      locationId: locA,
      execution: { id: randomUUID(), agencyId: agencyA, locationId: locB, status: 'running' },
      flow: { id: randomUUID() },
      platformDbEnabled: false,
      isStagingOrProd: false
    });
    assert.equal(resDevLocationConflict, null, 'Dev mode conflict must return null');

    const resDevAgencyConflict = await persistCompletedWorkflowExecution({
      pgPool: fakePool,
      agencyId: agencyA,
      locationId: locA,
      execution: { id: randomUUID(), agencyId: agencyB, locationId: locA, status: 'completed' },
      flow: { id: randomUUID() },
      platformDbEnabled: false,
      isStagingOrProd: false
    });
    assert.equal(resDevAgencyConflict, null, 'Dev mode conflict must return null');
  });
});
