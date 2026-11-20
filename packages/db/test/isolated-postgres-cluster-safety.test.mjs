import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  IsolatedTestPostgres,
  isPortOccupied,
  getAvailablePort,
  canonicalizePath,
  parsePostmasterPid,
  isProcessAlive
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

function createTempClusterDir(name) {
  const dir = path.join(root, 'scratch', `test-${name}-${Date.now()}-${Math.floor(Math.random() * 100000)}`);
  rmSync(dir, { recursive: true, force: true });
  return dir;
}

test('Phase 20.2.5.11: PostgreSQL Teardown Guarantees, Fail-Closed Probe Ordering & Regression Test Integrity', async (t) => {

  // =========================================================================
  // Test Suite 1: Platform-Aware Path Identity Verification (canonicalizePath)
  // =========================================================================
  await t.test('1. Platform-Aware Path Identity: Canonicalizes correctly according to platform semantics', () => {
    // 1a. Windows semantics: case-insensitive, forward slashes, trailing slashes stripped
    const winPathA = canonicalizePath('C:\\Data\\PostgreSQL\\', 'win32');
    const winPathB = canonicalizePath('c:/data/postgresql', 'win32');
    assert.equal(winPathA, winPathB, 'Windows paths must match case-insensitively');
    assert.ok(!winPathA.endsWith('/'), 'Trailing slash must be stripped');

    // 1b. Linux/macOS semantics: case-sensitive, case preserved
    const linuxPathA = canonicalizePath('/var/lib/PostgreSQL', 'linux');
    const linuxPathB = canonicalizePath('/var/lib/postgresql', 'linux');
    assert.notEqual(linuxPathA, linuxPathB, 'Linux paths must preserve case and NOT match when case differs');

    // 1c. Darwin/macOS semantics: case preserved
    const macPathA = canonicalizePath('/Users/postgres/Data', 'darwin');
    const macPathB = canonicalizePath('/Users/postgres/data', 'darwin');
    assert.notEqual(macPathA, macPathB, 'Darwin paths must preserve case');

    // 1d. Normalization of redundant slashes and dots
    const dirtyPath = canonicalizePath('/var/lib//pg/./data///', 'linux');
    assert.equal(dirtyPath, path.resolve('/var/lib/pg/data').replace(/\\/g, '/'), 'Redundant separators and dots must be normalized');

    // 1e. Empty/null input handling
    assert.equal(canonicalizePath(''), '');
    assert.equal(canonicalizePath(null), '');
  });

  // =========================================================================
  // Test Suite 2: Ephemeral Clusters & Dynamic Port Allocation
  // =========================================================================
  await t.test('2. Ephemeral Cluster: Starts on dynamically allocated port and verifies cluster identity', async () => {
    const dataDir = createTempClusterDir('ephemeral-cluster');
    const server = new IsolatedTestPostgres({
      port: 0,
      dbName: 'operza_ephemeral_test',
      dataDir,
      skipRoleBootstrap: true,
      forceIsolatedCluster: true
    });

    try {
      const dbUrl = await server.start();
      assert.ok(server.port > 1024, `Dynamic port should be unprivileged (>1024), got ${server.port}`);
      assert.equal(server.started, true, 'Server must be marked started');

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
        assert.equal(dbRes.rows[0].current_database, 'operza_ephemeral_test');
      } finally {
        await pool.end();
      }

      await server.stop();
      assert.equal(server.started, false, 'Server must be marked stopped after verified teardown');

      const stillOccupied = await isPortOccupied(server.port);
      assert.equal(stillOccupied, false, `Port ${server.port} must be released after teardown`);
    } finally {
      await server.stop().catch(() => {});
      server.cleanupDataDir();
    }
  });

  // =========================================================================
  // Test Suite 3: Port Collision & Cluster Identity Safety
  // =========================================================================
  await t.test('3. Port Collision: Startup fails closed without touching existing server or databases', async () => {
    const dataDir1 = createTempClusterDir('collision-primary');
    const server1 = new IsolatedTestPostgres({
      port: 0,
      dbName: 'primary_cluster_db',
      dataDir: dataDir1,
      skipRoleBootstrap: true,
      forceIsolatedCluster: true
    });

    const server1Url = await server1.start();
    const server1Port = server1.port;

    const pool1 = new pg.Pool({ connectionString: server1Url, max: 1 });
    try {
      await pool1.query('CREATE TABLE sentinel_untouched_table (id int, label text);');
      await pool1.query("INSERT INTO sentinel_untouched_table VALUES (1, 'sentinel_value_keep_safe');");
    } finally {
      await pool1.end();
    }

    const dataDir2 = createTempClusterDir('collision-secondary');
    const server2 = new IsolatedTestPostgres({
      port: server1Port, // Force port collision
      dbName: 'primary_cluster_db',
      dataDir: dataDir2,
      skipRoleBootstrap: true,
      forceIsolatedCluster: true
    });

    try {
      await assert.rejects(
        () => server2.start(),
        (err) => err.message.includes('PortCollisionError') && err.message.includes(`Port ${server1Port} is already in use`),
        'Server 2 must immediately fail closed on port collision'
      );

      assert.equal(server2.started, false, 'Server 2 must not be marked started');

      // Verify Server 1 is STILL running and its database & sentinel data remain completely untouched
      const checkPool1 = new pg.Pool({ connectionString: server1Url, max: 1 });
      try {
        const checkRes = await checkPool1.query('SELECT label FROM sentinel_untouched_table WHERE id = 1;');
        assert.equal(checkRes.rowCount, 1, 'Sentinel table must still exist on Server 1');
        assert.equal(checkRes.rows[0].label, 'sentinel_value_keep_safe', 'Sentinel data must be completely preserved');
      } finally {
        await checkPool1.end();
      }

      // Safe repeated stop on unstarted server2
      await server2.stop();

      const verifyServer1StillUp = new pg.Pool({ connectionString: server1Url, max: 1 });
      try {
        const pingRes = await verifyServer1StillUp.query('SELECT 1;');
        assert.equal(pingRes.rowCount, 1, 'Server 1 must remain online after stopping unstarted Server 2');
      } finally {
        await verifyServer1StillUp.end();
      }
    } finally {
      await server2.stop().catch(() => {});
      server2.cleanupDataDir();

      await server1.stop();
      server1.cleanupDataDir();

      const portNowFree = await isPortOccupied(server1Port);
      assert.equal(portNowFree, false, `Port ${server1Port} must be free after Server 1 teardown`);
    }
  });

  // =========================================================================
  // Test Suite 4: PostgreSQL Shutdown Verification Guarantees
  // =========================================================================
  await t.test('4. PostgreSQL Teardown Guarantees: Verified shutdown, repeated stop, failure detection & safety', async (tSub) => {
    // 4a. Normal verified shutdown
    await tSub.test('4a. Normal shutdown: Verifies process exit, PID disappearance, and port release', async () => {
      const dir = createTempClusterDir('shutdown-normal');
      const server = new IsolatedTestPostgres({
        port: 0,
        dbName: 'shutdown_normal_db',
        dataDir: dir,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });

      try {
        await server.start();
        const serverPort = server.port;
        const pidFile = path.join(dir, 'postmaster.pid');
        assert.ok(existsSync(pidFile), 'postmaster.pid must exist while running');
        const parsed = parsePostmasterPid(readFileSync(pidFile, 'utf8'));
        assert.ok(parsed && parsed.pid > 0, 'Must parse valid PID');
        const targetPid = parsed.pid;
        assert.equal(isProcessAlive(targetPid), true, 'Process must be alive while server is running');

        // Stop server
        await server.stop();

        assert.equal(server.started, false, 'Server must be marked started = false after stop');
        assert.equal(existsSync(pidFile), false, 'postmaster.pid must be removed after stop');
        assert.equal(isProcessAlive(targetPid), false, 'Process must have exited');
        assert.equal(await isPortOccupied(serverPort), false, 'Port must be released');
      } finally {
        await server.stop().catch(() => {});
        server.cleanupDataDir();
      }
    });

    // 4b. Repeated shutdown: Idempotent and safe after successful stop
    await tSub.test('4b. Repeated shutdown: Safe and idempotent without error', async () => {
      const dir = createTempClusterDir('shutdown-repeated');
      const server = new IsolatedTestPostgres({
        port: 0,
        dbName: 'shutdown_repeated_db',
        dataDir: dir,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });

      try {
        await server.start();
        await server.stop();
        assert.equal(server.started, false);

        // Calling stop() a second time must return cleanly
        await assert.doesNotReject(() => server.stop(), 'Second call to stop() must be safe and idempotent');
        assert.equal(server.started, false);
      } finally {
        await server.stop().catch(() => {});
        server.cleanupDataDir();
      }
    });

    // 4c. Failed shutdown command: Server remains running, throws PostgresShutdownError, preserves started = true
    await tSub.test('4c. Failed shutdown command: Surfaces failure and preserves started=true', async () => {
      const dir = createTempClusterDir('shutdown-cmd-fail');
      const server = new IsolatedTestPostgres({
        port: 0,
        dbName: 'shutdown_cmd_fail_db',
        dataDir: dir,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });

      try {
        await server.start();
        const serverPort = server.port;

        // Attempt stop with simulated command failure and short timeout (800ms)
        await assert.rejects(
          () => server.stop({ _simulateShutdownCommandFailure: true, timeoutMs: 800 }),
          (err) => err.message.includes('PostgresShutdownError') && err.message.includes('process') && err.message.includes('still alive'),
          'Must throw PostgresShutdownError when shutdown command fails and process remains alive'
        );

        assert.equal(server.started, true, 'Server state must remain started = true when shutdown verification fails');
        assert.equal(await isPortOccupied(serverPort), true, 'Port must still be occupied by running server');

        // Clean up genuine server
        await server.stop();
        assert.equal(server.started, false);
      } finally {
        await server.stop().catch(() => {});
        server.cleanupDataDir();
      }
    });

    // 4d. PID file remains after timeout: Surfaces failure and preserves started = true
    await tSub.test('4d. PID file remains after timeout: Throws PostgresShutdownError', async () => {
      const dir = createTempClusterDir('shutdown-pid-remains');
      const server = new IsolatedTestPostgres({
        port: 0,
        dbName: 'shutdown_pid_remains_db',
        dataDir: dir,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });

      try {
        await server.start();

        await assert.rejects(
          () => server.stop({ _simulatePidFileRemains: true, timeoutMs: 600 }),
          (err) => err.message.includes('PostgresShutdownError') && err.message.includes('PID file still exists'),
          'Must throw PostgresShutdownError when PID file remains after timeout'
        );

        assert.equal(server.started, true, 'Server state must remain started = true when PID file verification fails');

        // Now perform actual stop
        await server.stop();
        assert.equal(server.started, false);
      } finally {
        await server.stop().catch(() => {});
        server.cleanupDataDir();
      }
    });

    // 4e. Port remains occupied after expected shutdown: Throws PostgresShutdownError
    await tSub.test('4e. Port remains occupied after expected shutdown: Throws PostgresShutdownError', async () => {
      const dir = createTempClusterDir('shutdown-port-occupied');
      const server = new IsolatedTestPostgres({
        port: 0,
        dbName: 'shutdown_port_occupied_db',
        dataDir: dir,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });

      try {
        await server.start();

        await assert.rejects(
          () => server.stop({ _simulatePortOccupied: true, timeoutMs: 600 }),
          (err) => err.message.includes('PostgresShutdownError') && err.message.includes('still occupied'),
          'Must throw PostgresShutdownError when port remains occupied'
        );

        assert.equal(server.started, true, 'Server state must remain started = true when port verification fails');

        // Now perform actual stop
        await server.stop();
        assert.equal(server.started, false);
      } finally {
        await server.stop().catch(() => {});
        server.cleanupDataDir();
      }
    });

    // 4f. Ensuring an unrelated server remains untouched
    await tSub.test('4f. Ensuring an unrelated server remains untouched: Identity mismatch prevents stopping other clusters', async () => {
      const dirA = createTempClusterDir('shutdown-server-a');
      const serverA = new IsolatedTestPostgres({
        port: 0,
        dbName: 'server_a_db',
        dataDir: dirA,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });

      const serverAUrl = await serverA.start();
      const serverAPort = serverA.port;

      // Create an attacker / mismatched Server B instance that points to Server A's data dir but specifies a wrong port
      const serverB = new IsolatedTestPostgres({
        port: serverAPort + 1, // Mismatched port
        dbName: 'server_b_db',
        dataDir: dirA, // Targets Server A's dataDir!
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });
      serverB.started = true; // Pretend it was started

      try {
        // Attempting to stop Server B must detect port mismatch in postmaster.pid and refuse to stop Server A
        await assert.rejects(
          () => serverB.stop(),
          (err) => err.message.includes('ShutdownPortMismatchError') && err.message.includes('Refusing to stop unrelated server'),
          'Must refuse to stop cluster when postmaster.pid port does not match'
        );

        // Verify Server A is STILL online, alive, and queryable
        const checkPoolA = new pg.Pool({ connectionString: serverAUrl, max: 1 });
        try {
          const res = await checkPoolA.query('SELECT 42 AS num;');
          assert.equal(res.rows[0].num, 42, 'Server A must remain completely unaffected');
        } finally {
          await checkPoolA.end();
        }
      } finally {
        serverB.started = false;
        await serverA.stop();
        serverA.cleanupDataDir();
      }
    });

    // 4g. Data directory safety: Refuses deletion while server is running
    await tSub.test('4g. Data directory safety: Refuses to delete dataDir while server is marked started', async () => {
      const dir = createTempClusterDir('dir-safety-cluster');
      const server = new IsolatedTestPostgres({
        port: 0,
        dbName: 'dir_safety_db',
        dataDir: dir,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });

      try {
        await server.start();

        // Attempting to delete data dir while server.started === true must throw SafetyError
        assert.throws(
          () => server.cleanupDataDir(),
          (err) => err.message.includes('SafetyError') && err.message.includes('Refusing to delete data directory while PostgreSQL instance is marked started'),
          'Must refuse to delete dataDir while instance is running'
        );

        await server.stop();
        // After stop, cleanupDataDir succeeds
        assert.doesNotThrow(() => server.cleanupDataDir());
        assert.equal(existsSync(dir), false, 'Data directory must be removed after safe cleanup');
      } finally {
        await server.stop().catch(() => {});
        server.cleanupDataDir();
      }
    });
  });

  // =========================================================================
  // Test Suite 5: Real Exception-Safe Startup Cleanup
  // =========================================================================
  await t.test('5. Real Exception-Safe Startup Cleanup: Setup failure cleans up and preserves original error', async (tSub) => {
    // 5a. Post-startup failure triggers automatic teardown and releases resources without touching unrelated server
    await tSub.test('5a. Post-startup failure: Releases process and port, preserves error, leaves unrelated server intact', async () => {
      // Start unrelated Server A
      const dirA = createTempClusterDir('startup-cleanup-server-a');
      const serverA = new IsolatedTestPostgres({
        port: 0,
        dbName: 'unrelated_server_a',
        dataDir: dirA,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });
      const serverAUrl = await serverA.start();
      const serverAPort = serverA.port;

      // Start Server B with controlled failure injected immediately after startup & identity verification
      const dirB = createTempClusterDir('startup-cleanup-server-b');
      const serverB = new IsolatedTestPostgres({
        port: 0,
        dbName: 'failing_server_b',
        dataDir: dirB,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true,
        _simulatePostStartupFailure: true
      });

      try {
        let serverBPort = null;
        let caughtErr = null;
        try {
          await serverB.start();
        } catch (err) {
          caughtErr = err;
          serverBPort = serverB.port;
        }

        // 1. Original error must be preserved
        assert.ok(caughtErr !== null, 'Must reject on post-startup failure');
        assert.ok(
          caughtErr.message.includes('[TEST-SIMULATED] Controlled post-startup initialization failure'),
          `Original error must be preserved, got: ${caughtErr.message}`
        );

        // 2. Server B must be marked stopped
        assert.equal(serverB.started, false, 'Server B must be marked started = false after cleanup');

        // 3. Server B postmaster.pid must be gone and port must be free
        const pidFileB = path.join(dirB, 'postmaster.pid');
        assert.equal(existsSync(pidFileB), false, 'Server B postmaster.pid must disappear');
        if (serverBPort) {
          assert.equal(await isPortOccupied(serverBPort), false, `Server B port ${serverBPort} must be released`);
        }

        // 4. Unrelated Server A must remain completely unaffected and queryable
        const poolA = new pg.Pool({ connectionString: serverAUrl, max: 1 });
        try {
          const resA = await poolA.query('SELECT 1234 AS test_val;');
          assert.equal(resA.rows[0].test_val, 1234, 'Server A must continue answering queries');
        } finally {
          await poolA.end();
        }
      } finally {
        await serverB.stop().catch(() => {});
        serverB.cleanupDataDir();

        await serverA.stop();
        serverA.cleanupDataDir();
      }
    });

    // 5b. Cleanup errors during startup failure are not silently swallowed
    await tSub.test('5b. Cleanup errors during setup failure are chained and surfaced', async () => {
      const dir = createTempClusterDir('startup-cleanup-double-fail');
      const server = new IsolatedTestPostgres({
        port: 0,
        dbName: 'double_fail_db',
        dataDir: dir,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true,
        _simulatePostStartupFailure: true,
        _simulateCleanupErrorOnStartupFailure: true
      });

      try {
        await assert.rejects(
          () => server.start(),
          (err) => {
            const hasSetup = err.message.includes('Startup failed with:') && err.message.includes('Controlled post-startup initialization failure');
            const hasCleanup = err.message.includes('Subsequent cleanup also failed:') && err.message.includes('Simulated teardown error');
            return hasSetup && hasCleanup;
          },
          'Must surface both setup failure and teardown cleanup failure'
        );

      } finally {
        server.options._simulateCleanupErrorOnStartupFailure = false;
        await server.stop().catch(() => {});
        server.cleanupDataDir();
      }
    });
  });

  // =========================================================================
  // Test Suite 6: Pre-Mutation Stage A Probe Validation & Fail-Closed Ordering
  // =========================================================================
  await t.test('6. Pre-Mutation Stage A Probe Ordering: Unauthorized probe rejected BEFORE any database mutation', async () => {
    const clusterDir = createTempClusterDir('probe-ordering-cluster');
    const server = new IsolatedTestPostgres({
      port: 0,
      dbName: 'probe_ordering_db',
      dataDir: clusterDir,
      skipRoleBootstrap: true,
      forceIsolatedCluster: true
    });

    const adminUrl = await server.start();
    const adminPool = new pg.Pool({ connectionString: adminUrl, max: 5 });

    try {
      // 1. Snapshot catalog state before unauthorized probe attempt
      const snapExtBefore = await adminPool.query("SELECT extname FROM pg_extension WHERE extname = 'btree_gist';");
      const snapRolesBefore = await adminPool.query("SELECT rolname FROM pg_roles WHERE rolname IN ('operza_auth_definer', 'operza_migrator', 'operza_app', 'operza_worker');");
      const snapFuncBefore = await adminPool.query("SELECT proname FROM pg_proc WHERE proname = 'provision_security_role';");

      assert.equal(snapExtBefore.rowCount, 0, 'btree_gist must not exist prior to bootstrap');
      assert.equal(snapRolesBefore.rowCount, 0, 'No operza roles must exist prior to bootstrap');
      assert.equal(snapFuncBefore.rowCount, 0, 'provision_security_role function must not exist prior to bootstrap');

      // 2. Attempt bootstrap with unauthorized probe (allowTestProbe omitted)
      await assert.rejects(
        () => runPrivilegedBootstrap(adminPool, {
          migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
          roleProvisioningProbe: async () => {}
        }),
        (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is disabled by default and rejected without explicit test opt-in'),
        'Must reject unauthorized probe before mutations'
      );

      // 3. Snapshot catalog state AFTER unauthorized probe attempt: MUST HAVE ZERO PRIVILEGED SIDE EFFECTS
      const snapExtAfter = await adminPool.query("SELECT extname FROM pg_extension WHERE extname = 'btree_gist';");
      const snapRolesAfter = await adminPool.query("SELECT rolname FROM pg_roles WHERE rolname IN ('operza_auth_definer', 'operza_migrator', 'operza_app', 'operza_worker');");
      const snapFuncAfter = await adminPool.query("SELECT proname FROM pg_proc WHERE proname = 'provision_security_role';");

      assert.equal(snapExtAfter.rowCount, 0, 'CRITICAL: btree_gist was NOT created during unauthorized probe rejection');
      assert.equal(snapRolesAfter.rowCount, 0, 'CRITICAL: No operza roles were created during unauthorized probe rejection');
      assert.equal(snapFuncAfter.rowCount, 0, 'CRITICAL: provision_security_role was NOT created during unauthorized probe rejection');
    } finally {
      await adminPool.end();
      await server.stop();
      server.cleanupDataDir();
    }
  });

  // =========================================================================
  // Test Suite 7: Strict Test-Only Authorization Matrix
  // =========================================================================
  await t.test('7. Strict Test-Only Authorization: Matrix of environment and opt-in combinations', async () => {
    const clusterDir = createTempClusterDir('auth-matrix-cluster');
    const server = new IsolatedTestPostgres({
      port: 0,
      dbName: 'auth_matrix_db',
      dataDir: clusterDir,
      skipRoleBootstrap: true,
      forceIsolatedCluster: true
    });

    const adminUrl = await server.start();
    const adminPool = new pg.Pool({ connectionString: adminUrl, max: 5 });

    const origNodeEnv = process.env.NODE_ENV;
    const origProbeEnv = process.env.ALLOW_STAGE_A_PROBE;

    try {
      // 7a. Test environment with explicit opt-in (NODE_ENV="test", allowTestProbe=true) -> SUCCEEDS
      process.env.NODE_ENV = 'test';
      delete process.env.ALLOW_STAGE_A_PROBE;

      let probeRan = false;
      let probeInvoker = null;
      let probeSessionPid = null;

      await runPrivilegedBootstrap(adminPool, {
        migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
        allowTestProbe: true,
        roleProvisioningProbe: async (invoker, sessionPid) => {
          probeRan = true;
          probeInvoker = invoker;
          probeSessionPid = sessionPid;
        }
      });

      assert.equal(probeRan, true, 'Probe must execute when explicitly opted-in under NODE_ENV="test"');
      assert.ok(typeof probeSessionPid === 'number', 'Probe must receive numeric session pid');

      // Assert restricted invoker capability surface
      assert.deepEqual(
        Object.keys(probeInvoker).sort(),
        ['getBackendPid', 'invoke'],
        'restrictedInvoker must strictly expose only getBackendPid and invoke'
      );
      assert.equal(probeInvoker.client, undefined, 'Must not expose raw client');
      assert.equal(probeInvoker.query, undefined, 'Must not expose raw query method');

      // 7b. Test environment without opt-in (allowTestProbe: undefined) -> REJECTED
      await assert.rejects(
        () => runPrivilegedBootstrap(adminPool, {
          migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
          roleProvisioningProbe: async () => {}
        }),
        (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is disabled by default'),
        'Must reject probe when opt-in is omitted'
      );

      // 7c. Test environment with opt-in explicitly false (allowTestProbe: false) -> REJECTED
      await assert.rejects(
        () => runPrivilegedBootstrap(adminPool, {
          migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
          allowTestProbe: false,
          roleProvisioningProbe: async () => {}
        }),
        (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is disabled by default'),
        'Must reject probe when allowTestProbe is false'
      );

      // 7d. Development environment (NODE_ENV="development") -> REJECTED
      process.env.NODE_ENV = 'development';
      await assert.rejects(
        () => runPrivilegedBootstrap(adminPool, {
          migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
          allowTestProbe: true,
          roleProvisioningProbe: async () => {}
        }),
        (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe requires an explicit test environment'),
        'Must reject probe when NODE_ENV is "development"'
      );

      // 7e. Production environment (NODE_ENV="production") -> REJECTED UNCONDITIONALLY
      process.env.NODE_ENV = 'production';
      await assert.rejects(
        () => runPrivilegedBootstrap(adminPool, {
          migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
          allowTestProbe: true,
          roleProvisioningProbe: async () => {}
        }),
        (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is strictly forbidden in production environments'),
        'Must reject probe unconditionally in production environment'
      );

      // 7f. Unset NODE_ENV -> REJECTED
      delete process.env.NODE_ENV;
      await assert.rejects(
        () => runPrivilegedBootstrap(adminPool, {
          migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
          allowTestProbe: true,
          roleProvisioningProbe: async () => {}
        }),
        (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe requires an explicit test environment (NODE_ENV="test"). Current NODE_ENV is unset.'),
        'Must reject probe when NODE_ENV is unset'
      );

      // 7g. Environment opt-in set (ALLOW_STAGE_A_PROBE=true) while NODE_ENV is unset -> REJECTED
      process.env.ALLOW_STAGE_A_PROBE = 'true';
      delete process.env.NODE_ENV;
      await assert.rejects(
        () => runPrivilegedBootstrap(adminPool, {
          migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
          allowTestProbe: true,
          roleProvisioningProbe: async () => {}
        }),
        (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe requires an explicit test environment (NODE_ENV="test"). Current NODE_ENV is unset.'),
        'Must reject probe even if ALLOW_STAGE_A_PROBE is set when NODE_ENV is unset'
      );

      // 7h. Non-boolean opt-in values -> REJECTED
      process.env.NODE_ENV = 'test';
      delete process.env.ALLOW_STAGE_A_PROBE;

      for (const invalidOptIn of ['true', '1', 1, {}, []]) {
        await assert.rejects(
          () => runPrivilegedBootstrap(adminPool, {
            migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
            allowTestProbe: invalidOptIn,
            roleProvisioningProbe: async () => {}
          }),
          (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is disabled by default'),
          `Must reject non-boolean opt-in value: ${JSON.stringify(invalidOptIn)}`
        );
      }

      // 7i. Obsolete alias (__dangerouslyEnableTestProbe: true without allowTestProbe: true) -> REJECTED
      await assert.rejects(
        () => runPrivilegedBootstrap(adminPool, {
          migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
          __dangerouslyEnableTestProbe: true,
          roleProvisioningProbe: async () => {}
        }),
        (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is disabled by default and rejected without explicit test opt-in'),
        'Must reject obsolete __dangerouslyEnableTestProbe alias'
      );

      // 7j. Non-function probe -> REJECTED
      await assert.rejects(
        () => runPrivilegedBootstrap(adminPool, {
          migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
          allowTestProbe: true,
          roleProvisioningProbe: 'not_a_function'
        }),
        (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe must be a function'),
        'Must reject non-function roleProvisioningProbe'
      );

      // 7k. Production pipeline wrapper: runMigrationPipeline strips and NEVER forwards test probes
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
      process.env.NODE_ENV = origNodeEnv || 'test';
      if (origProbeEnv) process.env.ALLOW_STAGE_A_PROBE = origProbeEnv;
      else delete process.env.ALLOW_STAGE_A_PROBE;

      await adminPool.end();
      await server.stop();
      server.cleanupDataDir();
    }
  });
});
