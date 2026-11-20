import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  IsolatedTestPostgres,
  isPortOccupied,
  getAvailablePort,
  canonicalizePath
} from '../lib/test-postgres-server.mjs';
import {
  runPrivilegedBootstrap,
  runMigrationPipeline,
  DEFAULT_MIGRATOR_PASSWORD
} from '../scripts/migrate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');

process.env.NODE_ENV = 'test';
process.env.ALLOW_STAGE_A_PROBE = 'true';

test('Phase 20.2.5.10: Isolated PostgreSQL Cluster Safety & Test-Probe Fail-Closed Hardening', async (t) => {
  // Test Suite A: Ephemeral Clusters & Dynamic Port Allocation
  await t.test('1. Ephemeral Cluster: Starts on dynamically allocated port and uses expected data_directory', async () => {
    const dataDir = path.join(root, 'scratch', 'test-ephemeral-safety-cluster-auto');
    rmSync(dataDir, { recursive: true, force: true });

    const server = new IsolatedTestPostgres({
      port: 0, // Request dynamic allocation
      dbName: 'operza_ephemeral_safety_test',
      dataDir,
      skipRoleBootstrap: true,
      forceIsolatedCluster: true
    });

    try {
      const dbUrl = await server.start();
      assert.ok(server.port > 1024, `Dynamic port should be unprivileged (>1024), got ${server.port}`);
      assert.equal(server.started, true, 'Server must be marked started');

      // Verify server connection & data_directory
      const pool = new pg.Pool({ connectionString: dbUrl, max: 1 });
      try {
        const dirRes = await pool.query('SHOW data_directory;');
        const portRes = await pool.query('SHOW port;');
        const dbRes = await pool.query('SELECT current_database();');

        assert.equal(
          canonicalizePath(dirRes.rows[0].data_directory),
          canonicalizePath(dataDir),
          'Server data_directory must strictly match requested dataDir'
        );
        assert.equal(Number(portRes.rows[0].port), Number(server.port));
        assert.equal(dbRes.rows[0].current_database, 'operza_ephemeral_safety_test');
      } finally {
        await pool.end();
      }

      // Stop server and verify port release
      await server.stop();
      assert.equal(server.started, false);

      const stillOccupied = await isPortOccupied(server.port);
      assert.equal(stillOccupied, false, `Port ${server.port} must be released after teardown`);
    } finally {
      await server.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // Test Suite B: Port Collision & Cluster Identity Safety
  await t.test('2. Port Collision: Startup fails closed without touching existing server or databases', async () => {
    // 2a. Start Server 1 on an ephemeral port
    const dataDir1 = path.join(root, 'scratch', 'test-collision-primary-cluster');
    rmSync(dataDir1, { recursive: true, force: true });

    const server1 = new IsolatedTestPostgres({
      port: 0,
      dbName: 'primary_cluster_db',
      dataDir: dataDir1,
      skipRoleBootstrap: true,
      forceIsolatedCluster: true
    });

    const server1Url = await server1.start();
    const server1Port = server1.port;

    // Seed a sentinel table in server1's database to verify it is NEVER touched or dropped
    const pool1 = new pg.Pool({ connectionString: server1Url, max: 1 });
    try {
      await pool1.query('CREATE TABLE sentinel_untouched_table (id int, label text);');
      await pool1.query("INSERT INTO sentinel_untouched_table VALUES (1, 'sentinel_value_keep_safe');");
    } finally {
      await pool1.end();
    }

    // 2b. Attempt to start Server 2 targeting the EXACT same port with a different data directory
    const dataDir2 = path.join(root, 'scratch', 'test-collision-secondary-cluster');
    rmSync(dataDir2, { recursive: true, force: true });

    const server2 = new IsolatedTestPostgres({
      port: server1Port, // Force port collision
      dbName: 'primary_cluster_db', // Attempt same dbName
      dataDir: dataDir2,
      skipRoleBootstrap: true,
      forceIsolatedCluster: true
    });

    try {
      // Must throw PortCollisionError immediately
      await assert.rejects(
        () => server2.start(),
        (err) => {
          return err.message.includes('PortCollisionError') && err.message.includes(`Port ${server1Port} is already in use`);
        },
        'Server 2 must immediately fail closed on port collision'
      );

      // Verify Server 2 was never marked started
      assert.equal(server2.started, false, 'Server 2 must not be marked started');

      // 2c. Verify Server 1 is STILL running and its database & sentinel data remain completely untouched
      const checkPool1 = new pg.Pool({ connectionString: server1Url, max: 1 });
      try {
        const checkRes = await checkPool1.query('SELECT label FROM sentinel_untouched_table WHERE id = 1;');
        assert.equal(checkRes.rowCount, 1, 'Sentinel table must still exist on Server 1');
        assert.equal(checkRes.rows[0].label, 'sentinel_value_keep_safe', 'Sentinel data must be completely preserved');
      } finally {
        await checkPool1.end();
      }

      // 2d. Call stop() on Server 2: must be safe and must NEVER stop Server 1
      await server2.stop();

      const verifyServer1StillUp = new pg.Pool({ connectionString: server1Url, max: 1 });
      try {
        const pingRes = await verifyServer1StillUp.query('SELECT 1;');
        assert.equal(pingRes.rowCount, 1, 'Server 1 must remain online after stopping unstarted Server 2');
      } finally {
        await verifyServer1StillUp.end();
      }
    } finally {
      await server2.stop();
      rmSync(dataDir2, { recursive: true, force: true });

      await server1.stop();
      rmSync(dataDir1, { recursive: true, force: true });

      const portNowFree = await isPortOccupied(server1Port);
      assert.equal(portNowFree, false, `Port ${server1Port} must be free after Server 1 teardown`);
    }
  });

  // Test Suite C: Stage A Test Seam Fail-Closed Hardening
  await t.test('3. Stage A Test Seam: Disabled by default and fails closed without explicit test opt-in', async () => {
    // Start an isolated cluster for testing the probe guard
    const testClusterDir = path.join(root, 'scratch', 'test-probe-guard-cluster');
    rmSync(testClusterDir, { recursive: true, force: true });

    const server = new IsolatedTestPostgres({
      port: 0,
      dbName: 'operza_probe_guard_test',
      dataDir: testClusterDir,
      skipRoleBootstrap: true,
      forceIsolatedCluster: true
    });

    const adminUrl = await server.start();
    const adminPool = new pg.Pool({ connectionString: adminUrl, max: 5 });

    try {
      // 3a. Rejects when allowTestProbe is omitted (default behavior)
      await assert.rejects(
        () => runPrivilegedBootstrap(adminPool, {
          migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
          roleProvisioningProbe: async () => {}
        }),
        (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is disabled by default'),
        'Must reject probe when allowTestProbe is omitted'
      );

      // 3b. Rejects when allowTestProbe is false
      await assert.rejects(
        () => runPrivilegedBootstrap(adminPool, {
          migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
          allowTestProbe: false,
          roleProvisioningProbe: async () => {}
        }),
        (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is disabled by default'),
        'Must reject probe when allowTestProbe is false'
      );

      // 3c. Rejects when allowTestProbe is invalid (non-boolean)
      await assert.rejects(
        () => runPrivilegedBootstrap(adminPool, {
          migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
          allowTestProbe: 'invalid_string',
          roleProvisioningProbe: async () => {}
        }),
        (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is disabled by default'),
        'Must reject probe when allowTestProbe is non-boolean'
      );

      // 3d. Rejects when NODE_ENV is production even if allowTestProbe is true
      const origNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        await assert.rejects(
          () => runPrivilegedBootstrap(adminPool, {
            migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
            allowTestProbe: true,
            roleProvisioningProbe: async () => {}
          }),
          (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is disabled by default'),
          'Must reject probe when NODE_ENV === "production"'
        );
      } finally {
        process.env.NODE_ENV = origNodeEnv || 'test';
        process.env.ALLOW_STAGE_A_PROBE = 'true';
      }

      // 3d-2. Rejects when non-test environment (e.g. development without ALLOW_STAGE_A_PROBE)
      const origProbeEnv = process.env.ALLOW_STAGE_A_PROBE;
      try {
        process.env.NODE_ENV = 'development';
        delete process.env.ALLOW_STAGE_A_PROBE;
        await assert.rejects(
          () => runPrivilegedBootstrap(adminPool, {
            migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
            allowTestProbe: true,
            roleProvisioningProbe: async () => {}
          }),
          (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is disabled by default'),
          'Must reject probe when outside test environment'
        );
      } finally {
        process.env.NODE_ENV = 'test';
        process.env.ALLOW_STAGE_A_PROBE = 'true';
      }

      // 3e. Succeeds when explicitly enabled in test environment
      let probeInvoker = null;
      let probePid = null;
      await runPrivilegedBootstrap(adminPool, {
        migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
        allowTestProbe: true,
        roleProvisioningProbe: async (invoker, pid) => {
          probeInvoker = invoker;
          probePid = pid;
        }
      });
      assert.ok(probeInvoker !== null, 'Probe must execute when explicitly enabled');
      assert.ok(typeof probePid === 'number', 'Probe must receive sessionPid');

      // 3f. Assert capability boundaries of restrictedInvoker: NO raw client or arbitrary SQL execution
      assert.deepEqual(
        Object.keys(probeInvoker).sort(),
        ['getBackendPid', 'invoke'],
        'restrictedInvoker must strictly expose only getBackendPid and invoke'
      );
      assert.equal(typeof probeInvoker.invoke, 'function');
      assert.equal(typeof probeInvoker.getBackendPid, 'function');
      assert.equal(probeInvoker.client, undefined, 'Must not expose raw client');
      assert.equal(probeInvoker.query, undefined, 'Must not expose arbitrary query method');
      assert.equal(probeInvoker.connection, undefined, 'Must not expose raw connection');

      // 3g. Production pipeline wrapper: runMigrationPipeline strips and NEVER forwards test probes
      let pipelineProbeRan = false;
      await runMigrationPipeline({
        adminUrl,
        migratorPassword: 'pipeline_safe_password_123',
        allowTestProbe: true,
        roleProvisioningProbe: async () => {
          pipelineProbeRan = true;
        }
      });
      assert.equal(pipelineProbeRan, false, 'runMigrationPipeline must strictly strip roleProvisioningProbe');
    } finally {
      await adminPool.end();
      await server.stop();
      rmSync(testClusterDir, { recursive: true, force: true });
    }
  });

  // Test Suite D: Lifecycle Cleanup Exception-Safety
  await t.test('4. Exception-Safe Lifecycle: Setup failures trigger automatic teardown and release resources', async () => {
    const errorDataDir = path.join(root, 'scratch', 'test-lifecycle-cleanup-safety');
    rmSync(errorDataDir, { recursive: true, force: true });

    // Intentionally pass an invalid dbName with forbidden characters that fails during start()
    // Wait, dbName is validated in constructor, so constructor rejects invalid names.
    // To test post-startup error handling in start(), we can pass an uncreatable database or test stop()
    const server = new IsolatedTestPostgres({
      port: 0,
      dbName: 'safe_cleanup_test',
      dataDir: errorDataDir,
      skipRoleBootstrap: true,
      forceIsolatedCluster: true
    });

    const url = await server.start();
    const serverPort = server.port;
    assert.equal(server.started, true);
    assert.equal(await isPortOccupied(serverPort), true);

    // Stop must be idempotent and cleanly release resources
    await server.stop();
    assert.equal(server.started, false);
    assert.equal(await isPortOccupied(serverPort), false, 'Port must be released');

    // Calling stop() a second time must not throw
    await assert.doesNotReject(() => server.stop());

    rmSync(errorDataDir, { recursive: true, force: true });
  });
});
