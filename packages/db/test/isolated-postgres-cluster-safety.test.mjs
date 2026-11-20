import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

async function withEnv(overrides, action) {
  const saved = {};
  for (const k of Object.keys(overrides)) {
    saved[k] = process.env[k];
    if (overrides[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = overrides[k];
    }
  }
  try {
    return await action();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  }
}

async function safeTeardown(cleanups) {
  const errors = [];
  for (const action of cleanups) {
    if (!action) continue;
    try {
      await action();
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, `Multiple teardown failures:\n${errors.map(e => e.message).join('\n')}`);
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

    let pool = null;
    const poolErrors = [];

    try {
      const dbUrl = await server.start();
      assert.ok(server.port > 1024, `Dynamic port should be unprivileged (>1024), got ${server.port}`);
      assert.equal(server.started, true, 'Server must be marked started');
      assert.ok(typeof server.pid === 'number' && server.pid > 0, 'Server must retain verified process PID');

      pool = new pg.Pool({ connectionString: dbUrl, max: 1 });
      pool.on('error', (err) => poolErrors.push(err));

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
      await safeTeardown([
        () => pool && pool.end(),
        () => server.stop(),
        () => server.cleanupDataDir()
      ]);
      assert.equal(poolErrors.length, 0, 'Pool must not report errors during normal run');
      assert.equal(server.started, false, 'Server must be marked stopped after verified teardown');
      const stillOccupied = await isPortOccupied(server.port);
      assert.equal(stillOccupied, false, `Port ${server.port} must be released after teardown`);
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
    const pool1Errors = [];
    pool1.on('error', (err) => pool1Errors.push(err));

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
      await safeTeardown([
        () => server2.stop(),
        () => server2.cleanupDataDir(),
        () => server1.stop(),
        () => server1.cleanupDataDir()
      ]);

      const portNowFree = await isPortOccupied(server1Port);
      assert.equal(portNowFree, false, `Port ${server1Port} must be free after Server 1 teardown`);
    }
  });

  // =========================================================================
  // Test Suite 4: Fail-Closed Data-Directory Cleanup (cleanupDataDir)
  // =========================================================================
  await t.test('4. Fail-Closed Data Directory Cleanup: Refuses deletion on uncertain or active process identity', async (tSub) => {
    // 4a. Refuses deletion while instance is marked started
    await tSub.test('4a. Running instance: Refuses deletion when server.started === true', async () => {
      const dir = createTempClusterDir('cleanup-running');
      const server = new IsolatedTestPostgres({
        port: 0,
        dbName: 'running_cleanup_db',
        dataDir: dir,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });

      try {
        await server.start();
        assert.equal(server.started, true);

        assert.throws(
          () => server.cleanupDataDir(),
          (err) => err.message.includes('SafetyError') && err.message.includes('while PostgreSQL instance is marked started'),
          'Must reject directory deletion while started === true'
        );
      } finally {
        await safeTeardown([
          () => server.stop(),
          () => server.cleanupDataDir()
        ]);
      }
    });

    // 4b. Refuses deletion when PID file records a live process
    await tSub.test('4b. Live process: Refuses deletion when process in postmaster.pid is alive', async () => {
      const dir = createTempClusterDir('cleanup-live-proc');
      const server = new IsolatedTestPostgres({
        port: 0,
        dbName: 'live_proc_db',
        dataDir: dir,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });

      try {
        await server.start();
        const livePid = server.pid;
        assert.ok(livePid > 0);

        // Manually flip started to false to test PID inspection guard specifically
        server.started = false;

        assert.throws(
          () => server.cleanupDataDir(),
          (err) => err.message.includes('SafetyError') && err.message.includes(`while PostgreSQL process (PID ${livePid}) is alive`),
          'Must refuse deletion while recorded process is alive'
        );

        // Restore started flag so clean stop operates
        server.started = true;
      } finally {
        await safeTeardown([
          () => server.stop(),
          () => server.cleanupDataDir()
        ]);
      }
    });

    // 4c. Refuses deletion when PID file is malformed
    await tSub.test('4c. Malformed PID file: Refuses deletion on unparseable PID file', () => {
      const dir = createTempClusterDir('cleanup-malformed-pid');
      mkdirSync(dir, { recursive: true });
      const pidFile = path.join(dir, 'postmaster.pid');
      writeFileSync(pidFile, 'not_a_valid_number\n/some/path\n1234567\n5432\n', 'utf8');

      const server = new IsolatedTestPostgres({
        port: 0,
        dataDir: dir,
        skipRoleBootstrap: true
      });

      assert.throws(
        () => server.cleanupDataDir(),
        (err) => err.message.includes('SafetyError') && err.message.includes('PID file is malformed, incomplete, or contains an invalid PID'),
        'Must refuse deletion when PID file has non-numeric PID'
      );

      rmSync(dir, { recursive: true, force: true });
    });

    // 4d. Refuses deletion when PID file is missing PID field
    await tSub.test('4d. Missing PID field: Refuses deletion on empty PID file', () => {
      const dir = createTempClusterDir('cleanup-empty-pid');
      mkdirSync(dir, { recursive: true });
      const pidFile = path.join(dir, 'postmaster.pid');
      writeFileSync(pidFile, '', 'utf8');

      const server = new IsolatedTestPostgres({
        port: 0,
        dataDir: dir,
        skipRoleBootstrap: true
      });

      assert.throws(
        () => server.cleanupDataDir(),
        (err) => err.message.includes('SafetyError') && err.message.includes('PID file is malformed, incomplete, or contains an invalid PID'),
        'Must refuse deletion on empty PID file'
      );

      rmSync(dir, { recursive: true, force: true });
    });

    // 4e. Refuses deletion when PID file records a different data directory
    await tSub.test('4e. Directory mismatch: Refuses deletion when PID file belongs to another directory', () => {
      const dir = createTempClusterDir('cleanup-mismatch-dir');
      mkdirSync(dir, { recursive: true });
      const pidFile = path.join(dir, 'postmaster.pid');
      // Use safe non-existent PID 9999999 on Windows/POSIX
      writeFileSync(pidFile, '9999999\nC:/Different/DataDir\n1234567\n5432\n', 'utf8');

      const server = new IsolatedTestPostgres({
        port: 0,
        dataDir: dir,
        skipRoleBootstrap: true
      });

      assert.throws(
        () => server.cleanupDataDir(),
        (err) => err.message.includes('SafetyError') && err.message.includes('does not match instance directory'),
        'Must refuse deletion when recorded directory does not match'
      );

      rmSync(dir, { recursive: true, force: true });
    });

    // 4f. Successfully deletes directory when PID file process is confirmed exited
    await tSub.test('4f. Exited process: Safely deletes directory when process is confirmed not alive', () => {
      const dir = createTempClusterDir('cleanup-exited-proc');
      mkdirSync(dir, { recursive: true });
      const pidFile = path.join(dir, 'postmaster.pid');
      // Write verified matching directory with dead PID 9999999
      writeFileSync(pidFile, `9999999\n${canonicalizePath(dir)}\n1234567\n5432\n`, 'utf8');

      const server = new IsolatedTestPostgres({
        port: 0,
        dataDir: dir,
        skipRoleBootstrap: true
      });

      assert.doesNotThrow(() => server.cleanupDataDir());
      assert.equal(existsSync(dir), false, 'Directory must be removed when process is confirmed dead and dir matches');
    });

    // 4g. Idempotent cleanup when directory does not exist
    await tSub.test('4g. Idempotency: Returns cleanly when data directory does not exist', () => {
      const dir = path.join(root, 'scratch', 'test-non-existent-cluster-dir');
      rmSync(dir, { recursive: true, force: true });

      const server = new IsolatedTestPostgres({
        port: 0,
        dataDir: dir,
        skipRoleBootstrap: true
      });

      assert.doesNotThrow(() => server.cleanupDataDir(), 'Repeated cleanup of non-existent directory must succeed');
    });
  });

  // =========================================================================
  // Test Suite 5: Process Identity Retention & Verified Shutdown
  // =========================================================================
  await t.test('5. Process Identity Retention & Verified Shutdown: Positive verification and identity safety', async (tSub) => {
    // 5a. Normal shutdown: Verifies process exit, PID disappearance, and port release
    await tSub.test('5a. Normal shutdown: Verifies process exit, PID disappearance, and port release', async () => {
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
        const targetPid = server.pid;

        assert.ok(targetPid > 0, 'Instance must retain positive numeric PID');
        assert.equal(isProcessAlive(targetPid), true, 'Process must be alive while running');

        await server.stop();

        assert.equal(server.started, false, 'Server must be marked started = false');
        assert.equal(server.pid, null, 'Server PID must be cleared after verified stop');
        assert.equal(existsSync(path.join(dir, 'postmaster.pid')), false, 'postmaster.pid must disappear');
        assert.equal(isProcessAlive(targetPid), false, 'Process must have exited');
        assert.equal(await isPortOccupied(serverPort), false, 'Port must be released');
      } finally {
        await safeTeardown([
          () => server.stop(),
          () => server.cleanupDataDir()
        ]);
      }
    });

    // 5b. Repeated shutdown: Safe and idempotent
    await tSub.test('5b. Repeated shutdown: Safe and idempotent without error', async () => {
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

        await assert.doesNotReject(() => server.stop(), 'Second call to stop() must be safe and idempotent');
        assert.equal(server.started, false);
      } finally {
        await safeTeardown([
          () => server.stop(),
          () => server.cleanupDataDir()
        ]);
      }
    });

    // 5c. Missing PID file while original process remains alive: Fails closed, does not infer process exit
    await tSub.test('5c. Missing PID file: Refuses to report stopped while process is still alive', async () => {
      const dir = createTempClusterDir('shutdown-missing-pid-file');
      const server = new IsolatedTestPostgres({
        port: 0,
        dbName: 'missing_pid_file_db',
        dataDir: dir,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });

      try {
        await server.start();
        const targetPid = server.pid;
        const pidFile = path.join(dir, 'postmaster.pid');
        assert.ok(existsSync(pidFile));

        // Manually delete PID file while PostgreSQL process is STILL ALIVE
        rmSync(pidFile, { force: true });
        assert.equal(existsSync(pidFile), false, 'PID file artificially deleted');
        assert.equal(isProcessAlive(targetPid), true, 'Process is still running');

        // stop() must NOT assume process is dead just because PID file is gone!
        await assert.rejects(
          () => server.stop({ timeoutMs: 800 }),
          (err) => err.message.includes('PostgresShutdownError') && err.message.includes(`process ${targetPid} still alive`),
          'Must fail closed when PID file is missing but stored process is still alive'
        );

        assert.equal(server.started, true, 'Server state must remain started = true');

        // Recreate PID file so pg_ctl immediate stop can cleanly kill the process
        writeFileSync(pidFile, `${targetPid}\n${canonicalizePath(dir)}\n1234567\n${server.port}\n`, 'utf8');
        await server.stop();
        assert.equal(server.started, false);
      } finally {
        await safeTeardown([
          () => server.stop(),
          () => server.cleanupDataDir()
        ]);
      }
    });

    // 5d. Mismatched PID identity in postmaster.pid
    await tSub.test('5d. Mismatched PID: Refuses to stop server when PID in postmaster.pid does not match stored PID', async () => {
      const dir = createTempClusterDir('shutdown-pid-mismatch');
      const server = new IsolatedTestPostgres({
        port: 0,
        dbName: 'pid_mismatch_db',
        dataDir: dir,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });

      try {
        await server.start();
        const realPid = server.pid;
        const pidFile = path.join(dir, 'postmaster.pid');

        // Overwrite PID file with a different PID (e.g. realPid + 9999)
        const origContent = readFileSync(pidFile, 'utf8');
        const lines = origContent.split(/\r?\n/);
        lines[0] = String(realPid + 9999);
        writeFileSync(pidFile, lines.join('\n'), 'utf8');

        await assert.rejects(
          () => server.stop(),
          (err) => err.message.includes('ShutdownIdentityMismatchError') && err.message.includes('which does not match instance stored PID'),
          'Must reject stop when PID in postmaster.pid does not match stored PID'
        );

        // Restore genuine PID file to allow clean shutdown
        writeFileSync(pidFile, origContent, 'utf8');
        await server.stop();
        assert.equal(server.started, false);
      } finally {
        await safeTeardown([
          () => server.stop(),
          () => server.cleanupDataDir()
        ]);
      }
    });

    // 5e. Mismatched data-directory identity
    await tSub.test('5e. Mismatched data directory: Refuses to stop server when directory in PID file differs', async () => {
      const dir = createTempClusterDir('shutdown-dir-mismatch');
      const server = new IsolatedTestPostgres({
        port: 0,
        dbName: 'dir_mismatch_db',
        dataDir: dir,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });

      try {
        await server.start();
        const pidFile = path.join(dir, 'postmaster.pid');
        const origContent = readFileSync(pidFile, 'utf8');
        const lines = origContent.split(/\r?\n/);
        lines[1] = 'C:/Mismatched/Fake/Directory';
        writeFileSync(pidFile, lines.join('\n'), 'utf8');

        await assert.rejects(
          () => server.stop(),
          (err) => err.message.includes('ShutdownIdentityMismatchError') && err.message.includes('does not match instance data directory'),
          'Must reject stop when data directory in PID file does not match'
        );

        writeFileSync(pidFile, origContent, 'utf8');
        await server.stop();
        assert.equal(server.started, false);
      } finally {
        await safeTeardown([
          () => server.stop(),
          () => server.cleanupDataDir()
        ]);
      }
    });

    // 5f. Mismatched port identity
    await tSub.test('5f. Mismatched port: Refuses to stop server when port in PID file differs', async () => {
      const dir = createTempClusterDir('shutdown-port-mismatch');
      const server = new IsolatedTestPostgres({
        port: 0,
        dbName: 'port_mismatch_db',
        dataDir: dir,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });

      try {
        await server.start();
        const pidFile = path.join(dir, 'postmaster.pid');
        const origContent = readFileSync(pidFile, 'utf8');
        const lines = origContent.split(/\r?\n/);
        lines[3] = String(Number(server.port) + 10);
        writeFileSync(pidFile, lines.join('\n'), 'utf8');

        await assert.rejects(
          () => server.stop(),
          (err) => err.message.includes('ShutdownPortMismatchError') && err.message.includes('does not match instance port'),
          'Must reject stop when port in PID file does not match'
        );

        writeFileSync(pidFile, origContent, 'utf8');
        await server.stop();
        assert.equal(server.started, false);
      } finally {
        await safeTeardown([
          () => server.stop(),
          () => server.cleanupDataDir()
        ]);
      }
    });

    // 5g. Failed shutdown command
    await tSub.test('5g. Failed shutdown command: Surfaces failure and preserves started=true', async () => {
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

        await assert.rejects(
          () => server.stop({ _simulateShutdownCommandFailure: true, timeoutMs: 800 }),
          (err) => err.message.includes('PostgresShutdownError') && err.message.includes('process') && err.message.includes('still alive'),
          'Must throw PostgresShutdownError when command fails'
        );

        assert.equal(server.started, true, 'Server state must remain started = true');
        assert.equal(await isPortOccupied(serverPort), true, 'Port must still be occupied');

        await server.stop();
        assert.equal(server.started, false);
      } finally {
        await safeTeardown([
          () => server.stop(),
          () => server.cleanupDataDir()
        ]);
      }
    });

    // 5h. PID file remains after timeout
    await tSub.test('5h. PID file remains: Throws PostgresShutdownError and preserves started=true', async () => {
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
          'Must throw PostgresShutdownError when PID file remains'
        );

        assert.equal(server.started, true);

        await server.stop();
        assert.equal(server.started, false);
      } finally {
        await safeTeardown([
          () => server.stop(),
          () => server.cleanupDataDir()
        ]);
      }
    });

    // 5i. Port remains occupied after expected shutdown
    await tSub.test('5i. Port remains occupied: Throws PostgresShutdownError and preserves started=true', async () => {
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

        assert.equal(server.started, true);

        await server.stop();
        assert.equal(server.started, false);
      } finally {
        await safeTeardown([
          () => server.stop(),
          () => server.cleanupDataDir()
        ]);
      }
    });

    // 5j. Ensuring an unrelated server remains untouched
    await tSub.test('5j. Unrelated server safety: Identity mismatch prevents stopping other clusters', async () => {
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

      const serverB = new IsolatedTestPostgres({
        port: serverAPort + 1,
        dbName: 'server_b_db',
        dataDir: dirA,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true
      });
      serverB.started = true;

      try {
        await assert.rejects(
          () => serverB.stop(),
          (err) => err.message.includes('ShutdownPortMismatchError') && err.message.includes('Refusing to stop unrelated server'),
          'Must refuse to stop cluster when postmaster.pid port does not match'
        );

        const checkPoolA = new pg.Pool({ connectionString: serverAUrl, max: 1 });
        try {
          const res = await checkPoolA.query('SELECT 42 AS num;');
          assert.equal(res.rows[0].num, 42, 'Server A must remain completely unaffected');
        } finally {
          await checkPoolA.end();
        }
      } finally {
        serverB.started = false;
        await safeTeardown([
          () => serverA.stop(),
          () => serverA.cleanupDataDir()
        ]);
      }
    });
  });

  // =========================================================================
  // Test Suite 6: Real Exception-Safe Startup Cleanup
  // =========================================================================
  await t.test('6. Real Exception-Safe Startup Cleanup: Setup failure cleans up and preserves original error', async (tSub) => {
    // 6a. Post-startup failure triggers automatic teardown and releases resources without touching unrelated server
    await tSub.test('6a. Post-startup failure: Releases process and port, preserves error, leaves unrelated server intact', async () => {
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

      const dirB = createTempClusterDir('startup-cleanup-server-b');
      const serverB = new IsolatedTestPostgres({
        port: 0,
        dbName: 'failing_server_b',
        dataDir: dirB,
        skipRoleBootstrap: true,
        forceIsolatedCluster: true,
        _simulatePostStartupFailure: true
      });

      let serverBPort = null;
      let caughtErr = null;
      try {
        await serverB.start();
      } catch (err) {
        caughtErr = err;
        serverBPort = serverB.port;
      }

      try {
        assert.ok(caughtErr !== null, 'Must reject on post-startup failure');
        assert.ok(
          caughtErr.message.includes('[TEST-SIMULATED] Controlled post-startup initialization failure'),
          `Original error must be preserved, got: ${caughtErr.message}`
        );

        assert.equal(serverB.started, false, 'Server B must be marked started = false after cleanup');

        const pidFileB = path.join(dirB, 'postmaster.pid');
        assert.equal(existsSync(pidFileB), false, 'Server B postmaster.pid must disappear');
        if (serverBPort) {
          assert.equal(await isPortOccupied(serverBPort), false, `Server B port ${serverBPort} must be released`);
        }

        const poolA = new pg.Pool({ connectionString: serverAUrl, max: 1 });
        try {
          const resA = await poolA.query('SELECT 1234 AS test_val;');
          assert.equal(resA.rows[0].test_val, 1234, 'Server A must continue answering queries');
        } finally {
          await poolA.end();
        }
      } finally {
        await safeTeardown([
          () => serverB.stop(),
          () => serverB.cleanupDataDir(),
          () => serverA.stop(),
          () => serverA.cleanupDataDir()
        ]);
      }
    });

    // 6b. Cleanup errors during startup failure are chained and surfaced
    await tSub.test('6b. Cleanup errors during setup failure are chained and surfaced', async () => {
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
        await safeTeardown([
          () => server.stop(),
          () => server.cleanupDataDir()
        ]);
      }
    });
  });

  // =========================================================================
  // Test Suite 7: Pre-Mutation Stage A Probe Validation & Fail-Closed Ordering
  // =========================================================================
  await t.test('7. Pre-Mutation Stage A Probe Ordering: Unauthorized probe rejected BEFORE any database mutation', async () => {
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
      await safeTeardown([
        () => adminPool.end(),
        () => server.stop(),
        () => server.cleanupDataDir()
      ]);
    }
  });

  // =========================================================================
  // Test Suite 8: Strict Test-Only Authorization Matrix & Failure Injection Boundaries
  // =========================================================================
  await t.test('8. Strict Test-Only Authorization & Simulation Boundaries: Matrix of environment and opt-in combinations', async () => {
    // 8a. Test failure simulation options strictly rejected outside NODE_ENV === 'test'
    for (const nonTestEnv of ['production', 'development', undefined]) {
      await withEnv({ NODE_ENV: nonTestEnv }, async () => {
        assert.throws(
          () => new IsolatedTestPostgres({ _simulatePostStartupFailure: true }),
          (err) => err.message.includes('SecurityError: Test failure simulation options') && err.message.includes('are strictly forbidden outside NODE_ENV="test"'),
          `Constructor must reject simulation options under NODE_ENV=${nonTestEnv}`
        );

        assert.throws(
          () => new IsolatedTestPostgres({ _simulatePortOccupied: true }),
          (err) => err.message.includes('SecurityError: Test failure simulation options') && err.message.includes('are strictly forbidden outside NODE_ENV="test"'),
          `Constructor must reject _simulatePortOccupied under NODE_ENV=${nonTestEnv}`
        );
      });
    }

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

    try {
      // 8b. Test environment with explicit opt-in (NODE_ENV="test", allowTestProbe=true) -> SUCCEEDS
      await withEnv({ NODE_ENV: 'test', ALLOW_STAGE_A_PROBE: undefined }, async () => {
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
      });

      // 8c. Test environment without opt-in (allowTestProbe: undefined) -> REJECTED
      await withEnv({ NODE_ENV: 'test' }, async () => {
        await assert.rejects(
          () => runPrivilegedBootstrap(adminPool, {
            migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
            roleProvisioningProbe: async () => {}
          }),
          (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is disabled by default'),
          'Must reject probe when opt-in is omitted'
        );
      });

      // 8d. Test environment with opt-in explicitly false (allowTestProbe: false) -> REJECTED
      await withEnv({ NODE_ENV: 'test' }, async () => {
        await assert.rejects(
          () => runPrivilegedBootstrap(adminPool, {
            migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
            allowTestProbe: false,
            roleProvisioningProbe: async () => {}
          }),
          (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is disabled by default'),
          'Must reject probe when allowTestProbe is false'
        );
      });

      // 8e. Development environment (NODE_ENV="development") -> REJECTED
      await withEnv({ NODE_ENV: 'development' }, async () => {
        await assert.rejects(
          () => runPrivilegedBootstrap(adminPool, {
            migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
            allowTestProbe: true,
            roleProvisioningProbe: async () => {}
          }),
          (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe requires an explicit test environment'),
          'Must reject probe when NODE_ENV is "development"'
        );
      });

      // 8f. Production environment (NODE_ENV="production") -> REJECTED UNCONDITIONALLY
      await withEnv({ NODE_ENV: 'production' }, async () => {
        await assert.rejects(
          () => runPrivilegedBootstrap(adminPool, {
            migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
            allowTestProbe: true,
            roleProvisioningProbe: async () => {}
          }),
          (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is strictly forbidden in production environments'),
          'Must reject probe unconditionally in production environment'
        );
      });

      // 8g. Unset NODE_ENV -> REJECTED
      await withEnv({ NODE_ENV: undefined }, async () => {
        await assert.rejects(
          () => runPrivilegedBootstrap(adminPool, {
            migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
            allowTestProbe: true,
            roleProvisioningProbe: async () => {}
          }),
          (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe requires an explicit test environment (NODE_ENV="test"). Current NODE_ENV is unset.'),
          'Must reject probe when NODE_ENV is unset'
        );
      });

      // 8h. Environment opt-in set (ALLOW_STAGE_A_PROBE=true) while NODE_ENV is unset -> REJECTED
      await withEnv({ NODE_ENV: undefined, ALLOW_STAGE_A_PROBE: 'true' }, async () => {
        await assert.rejects(
          () => runPrivilegedBootstrap(adminPool, {
            migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
            allowTestProbe: true,
            roleProvisioningProbe: async () => {}
          }),
          (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe requires an explicit test environment (NODE_ENV="test"). Current NODE_ENV is unset.'),
          'Must reject probe even if ALLOW_STAGE_A_PROBE is set when NODE_ENV is unset'
        );
      });

      // 8i. Non-boolean opt-in values -> REJECTED
      await withEnv({ NODE_ENV: 'test', ALLOW_STAGE_A_PROBE: undefined }, async () => {
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
      });

      // 8j. Obsolete alias (__dangerouslyEnableTestProbe: true without allowTestProbe: true) -> REJECTED
      await withEnv({ NODE_ENV: 'test' }, async () => {
        await assert.rejects(
          () => runPrivilegedBootstrap(adminPool, {
            migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
            __dangerouslyEnableTestProbe: true,
            roleProvisioningProbe: async () => {}
          }),
          (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe is disabled by default and rejected without explicit test opt-in'),
          'Must reject obsolete __dangerouslyEnableTestProbe alias'
        );
      });

      // 8k. Non-function probe -> REJECTED
      await withEnv({ NODE_ENV: 'test' }, async () => {
        await assert.rejects(
          () => runPrivilegedBootstrap(adminPool, {
            migratorPassword: DEFAULT_MIGRATOR_PASSWORD,
            allowTestProbe: true,
            roleProvisioningProbe: 'not_a_function'
          }),
          (err) => err.message.includes('SECURITY_ERROR: roleProvisioningProbe must be a function'),
          'Must reject non-function roleProvisioningProbe'
        );
      });

      // 8l. Production pipeline wrapper: runMigrationPipeline strips and NEVER forwards test probes
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
      await safeTeardown([
        () => adminPool.end(),
        () => server.stop(),
        () => server.cleanupDataDir()
      ]);
    }
  });
});
