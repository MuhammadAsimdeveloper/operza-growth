import { spawn, spawnSync, execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');

const DEFAULT_BIN_DIRS = [
  process.env.PG_BIN_DIR,
  'C:\\Program Files\\PostgreSQL\\18\\bin',
  'C:\\Program Files\\PostgreSQL\\16\\bin',
  'C:\\Program Files\\PostgreSQL\\17\\bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/bin'
].filter(Boolean);

export function findPgBin(name) {
  for (const binDir of DEFAULT_BIN_DIRS) {
    const full = path.join(binDir, process.platform === 'win32' ? `${name}.exe` : name);
    if (existsSync(full)) return full;
  }
  return process.platform === 'win32' ? `${name}.exe` : name;
}

export function canonicalizePath(p, platform = process.platform) {
  if (!p || typeof p !== 'string') return '';
  const resolved = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function parsePostmasterPid(content) {
  if (!content || typeof content !== 'string') return null;
  const lines = content.trim().split(/\r?\n/);
  const pid = parseInt(lines[0], 10);
  const dataDir = lines[1] ? lines[1].trim() : '';
  const port = lines[3] ? parseInt(lines[3], 10) : null;
  return {
    pid: Number.isFinite(pid) && pid > 0 ? pid : null,
    dataDir,
    port: Number.isFinite(port) && port > 0 ? port : null
  };
}

export function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'EPERM') return true;
    return false;
  }
}

export async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    srv.on('error', reject);
  });
}

export async function isPortOccupied(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      const srv = net.createServer();
      srv.once('error', () => resolve(true));
      srv.once('listening', () => srv.close(() => resolve(false)));
      srv.listen(port, '127.0.0.1');
    });
    socket.once('error', (err) => {
      socket.destroy();
      if (err.code === 'ECONNREFUSED') {
        const srv = net.createServer();
        srv.once('error', (srvErr) => {
          if (srvErr.code === 'EADDRINUSE' || srvErr.code === 'EACCES') {
            resolve(true);
          } else {
            resolve(true);
          }
        });
        srv.once('listening', () => srv.close(() => resolve(false)));
        srv.listen(port, '127.0.0.1');
      } else {
        resolve(true);
      }
    });
    socket.connect(port, '127.0.0.1');
  });
}

export class IsolatedTestPostgres {
  constructor(options = {}) {
    this.options = options;
    this.requestedPort = options.port;
    this.port = typeof options.port === 'number' && options.port > 0 ? options.port : null;
    this.dbName = options.dbName || 'operza_test';
    if (!/^[a-zA-Z0-9_]{1,63}$/.test(this.dbName)) {
      throw new Error(`Invalid dbName "${this.dbName}". Must be 1-63 alphanumeric/underscore characters.`);
    }
    this.customDataDir = options.dataDir || null;
    this.dataDir = options.dataDir || null;
    this.started = false;
    this.isExternal = false;
    this.skipRoleBootstrap = options.skipRoleBootstrap || false;
    this.forceIsolatedCluster = options.forceIsolatedCluster || false;
  }

  async start() {
    if (process.env.OPERZA_TEST_DATABASE_URL && !this.forceIsolatedCluster) {
      this.isExternal = true;
      const parsed = new URL(process.env.OPERZA_TEST_DATABASE_URL);
      const suppliedDb = parsed.pathname.replace(/^\//, '');
      const targetDb = this.dbName;

      // Validate dbName format strictly
      if (!/^[a-zA-Z0-9_]{1,63}$/.test(targetDb)) {
        throw new Error(`Invalid target database name "${targetDb}". Must match ^[a-zA-Z0-9_]{1,63}$`);
      }

      // Safety check: Never drop or recreate reserved system or default databases
      const FORBIDDEN_DBS = new Set(['postgres', 'template0', 'template1', suppliedDb]);

      if (targetDb && targetDb !== suppliedDb) {
        if (FORBIDDEN_DBS.has(targetDb)) {
          throw new Error(`Cannot recreate database "${targetDb}": targeted database matches a reserved or supplied database name.`);
        }

        const { default: pg } = await import('pg');
        const adminPool = new pg.Pool({
          connectionString: process.env.OPERZA_TEST_DATABASE_URL,
          max: 1,
          connectionTimeoutMillis: 5000
        });

        try {
          // Attempt DROP DATABASE with FORCE (PG13+), fallback to standard DROP if syntax unsupported
          try {
            await adminPool.query(`DROP DATABASE IF EXISTS "${targetDb}" WITH (FORCE)`);
          } catch (dropErr) {
            await adminPool.query(`DROP DATABASE IF EXISTS "${targetDb}"`);
          }
          await adminPool.query(`CREATE DATABASE "${targetDb}"`);
        } finally {
          await adminPool.end();
        }

        parsed.pathname = `/${targetDb}`;

        // Bootstrap extensions and permissions on the newly isolated target database
        const dbPool = new pg.Pool({
          connectionString: parsed.toString(),
          max: 1,
          connectionTimeoutMillis: 5000
        });
        try {
          await dbPool.query('CREATE EXTENSION IF NOT EXISTS btree_gist;');
          if (!this.skipRoleBootstrap) {
            await dbPool.query(`
              DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_migrator') THEN
                  CREATE ROLE operza_migrator LOGIN PASSWORD 'operza_migrator_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_app') THEN
                  CREATE ROLE operza_app LOGIN PASSWORD 'operza_app_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_worker') THEN
                  CREATE ROLE operza_worker LOGIN PASSWORD 'operza_worker_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_auth_definer') THEN
                  CREATE ROLE operza_auth_definer NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
                END IF;
              END $$;
              DO $$ BEGIN
                IF NOT pg_has_role(current_user, 'operza_auth_definer', 'MEMBER') THEN
                  EXECUTE format('GRANT operza_auth_definer TO %I', current_user);
                END IF;
              END $$;
              GRANT operza_auth_definer TO operza_migrator;
            `);
            await dbPool.query(`GRANT ALL ON DATABASE "${targetDb}" TO operza_migrator;`);
            await dbPool.query(`GRANT CONNECT ON DATABASE "${targetDb}" TO operza_app, operza_worker;`);
            await dbPool.query('GRANT USAGE, CREATE ON SCHEMA public TO operza_migrator, operza_auth_definer;');
            await dbPool.query('GRANT USAGE ON SCHEMA public TO operza_app, operza_worker;');
          }
        } finally {
          await dbPool.end();
        }
      }

      this.connectionUrl = parsed.toString();
      return this.connectionUrl;
    }

    const initdbBin = findPgBin('initdb');
    const pgCtlBin = findPgBin('pg_ctl');
    const psqlBin = findPgBin('psql');

    // 1. Resolve port: dynamically assign if port is 0 or unassigned or ephemeral
    if (!this.port || this.options.ephemeral === true) {
      this.port = await getAvailablePort();
    }

    // 2. Resolve data directory
    if (!this.dataDir) {
      this.dataDir = path.join(root, 'scratch', `test-shared-pg-cluster-${this.port}`);
    }

    // 3. FAIL-CLOSED PORT COLLISION CHECK: Never reuse an existing server for an isolated cluster
    const portOccupied = await isPortOccupied(this.port);
    if (portOccupied) {
      throw new Error(
        `[ISOLATED-PG] PortCollisionError: Port ${this.port} is already in use by an existing process or PostgreSQL server. ` +
        `IsolatedTestPostgres refuses to reuse an existing cluster or perform destructive operations on an unverified server.`
      );
    }

    mkdirSync(path.dirname(this.dataDir), { recursive: true });

    // 4. Run initdb if cluster is not yet initialized or if version mismatch
    const pgVersionFile = path.join(this.dataDir, 'PG_VERSION');
    const binVerRes = spawnSync(initdbBin, ['--version'], { encoding: 'utf8' });
    const match = (binVerRes.stdout || '').match(/(\d+)/);
    const binMajor = match ? match[1] : '16';

    if (existsSync(pgVersionFile)) {
      const existingVer = readFileSync(pgVersionFile, 'utf8').trim();
      if (existingVer !== binMajor) {
        const pidFile = path.join(this.dataDir, 'postmaster.pid');
        if (existsSync(pidFile)) {
          const parsed = parsePostmasterPid(readFileSync(pidFile, 'utf8'));
          if (parsed?.pid && isProcessAlive(parsed.pid)) {
            throw new Error(`[ISOLATED-PG] SafetyError: Cannot recreate data directory because PostgreSQL process (PID ${parsed.pid}) is currently running in "${this.dataDir}".`);
          }
        }
        rmSync(this.dataDir, { recursive: true, force: true });
      }
    }

    if (!existsSync(pgVersionFile)) {
      const initRes = spawnSync(initdbBin, ['-D', this.dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '-N'], {
        encoding: 'utf8',
        timeout: 120000
      });
      if (initRes.status !== 0) {
        throw new Error(`initdb failed: ${initRes.stderr || initRes.stdout}`);
      }
    }

    // 5. Start pg_ctl on isolated port
    const logFile = path.join(this.dataDir, 'server.log');
    const startRes = spawnSync(pgCtlBin, ['-D', this.dataDir, '-o', `-p ${this.port} -F`, '-l', logFile, 'start'], {
      encoding: 'utf8',
      timeout: 20000
    });
    if (startRes.status !== 0) {
      throw new Error(`pg_ctl start failed on port ${this.port}: ${startRes.stderr || startRes.stdout}`);
    }
    this.started = true;

    // 6. Exception-safe post-startup verification & initialization
    try {
      // 6a. Poll until server is accepting queries
      let ready = false;
      for (let i = 0; i < 40; i++) {
        const probeRes = spawnSync(psqlBin, ['-U', 'postgres', '-h', '127.0.0.1', '-p', String(this.port), '-d', 'template1', '-c', 'SELECT 1;'], {
          encoding: 'utf8',
          timeout: 2000
        });
        if (probeRes.status === 0) {
          ready = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!ready) {
        throw new Error(`PostgreSQL server on port ${this.port} failed to become ready within timeout.`);
      }

      // 6b. VERIFY CLUSTER IDENTITY: Assert actual data_directory and port before any destructive operations
      const { default: pg } = await import('pg');
      const identityPool = new pg.Pool({
        connectionString: `postgresql://postgres@127.0.0.1:${this.port}/template1`,
        max: 1,
        connectionTimeoutMillis: 5000
      });

      let serverDataDir = '';
      let serverPort = '';
      try {
        const dirRes = await identityPool.query('SHOW data_directory;');
        const pRes = await identityPool.query('SHOW port;');
        serverDataDir = dirRes.rows[0].data_directory;
        serverPort = pRes.rows[0].port;
      } finally {
        await identityPool.end();
      }

      if (canonicalizePath(serverDataDir) !== canonicalizePath(this.dataDir)) {
        throw new Error(
          `[ISOLATED-PG] ClusterIdentityMismatchError: Running PostgreSQL data_directory "${serverDataDir}" ` +
          `does not match initialized cluster directory "${this.dataDir}". Aborting destructive operation.`
        );
      }

      if (Number(serverPort) !== Number(this.port)) {
        throw new Error(
          `[ISOLATED-PG] ClusterPortMismatchError: Running PostgreSQL port "${serverPort}" ` +
          `does not match requested port "${this.port}". Aborting destructive operation.`
        );
      }

      if (this.options._simulatePostStartupFailure) {
        throw new Error('[TEST-SIMULATED] Controlled post-startup initialization failure');
      }

      // 6c. Re-create isolated test database now that cluster identity is verified
      const dropRes = spawnSync(psqlBin, ['-U', 'postgres', '-h', '127.0.0.1', '-p', String(this.port), '-d', 'template1', '-c', `DROP DATABASE IF EXISTS "${this.dbName}";`], { encoding: 'utf8' });
      if (dropRes.status !== 0) {
        throw new Error(`Failed to drop database ${this.dbName}: ${dropRes.stderr || dropRes.stdout}`);
      }
      const createRes = spawnSync(psqlBin, ['-U', 'postgres', '-h', '127.0.0.1', '-p', String(this.port), '-d', 'template1', '-c', `CREATE DATABASE "${this.dbName}";`], { encoding: 'utf8' });
      if (createRes.status !== 0) {
        throw new Error(`Failed to create database ${this.dbName}: ${createRes.stderr || createRes.stdout}`);
      }

      this.connectionUrl = `postgresql://postgres@127.0.0.1:${this.port}/${this.dbName}`;

      // 6d. Bootstrap extensions and roles
      if (!this.skipRoleBootstrap) {
        const pool = new pg.Pool({ connectionString: this.connectionUrl, max: 1 });
        try {
          await pool.query('CREATE EXTENSION IF NOT EXISTS btree_gist;');
          await pool.query(`
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_migrator') THEN
                CREATE ROLE operza_migrator LOGIN PASSWORD 'operza_migrator_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_app') THEN
                CREATE ROLE operza_app LOGIN PASSWORD 'operza_app_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_worker') THEN
                CREATE ROLE operza_worker LOGIN PASSWORD 'operza_worker_secret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_auth_definer') THEN
                CREATE ROLE operza_auth_definer NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
              END IF;
            END $$;
            GRANT operza_auth_definer TO operza_migrator;
          `);
          await pool.query(`GRANT ALL ON DATABASE "${this.dbName}" TO postgres, operza_migrator;`);
          await pool.query(`GRANT CONNECT ON DATABASE "${this.dbName}" TO operza_app, operza_worker;`);
          await pool.query('GRANT USAGE, CREATE ON SCHEMA public TO postgres, operza_migrator, operza_auth_definer;');
          await pool.query('GRANT USAGE ON SCHEMA public TO operza_app, operza_worker;');

          await pool.query(`
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
        } finally {
          await pool.end();
        }
      }

      return this.connectionUrl;
    } catch (setupErr) {
      // Guaranteed teardown on setup failure: never leave PostgreSQL running
      let stopFailure = null;
      try {
        await this.stop();
      } catch (stopErr) {
        stopFailure = stopErr;
      }
      if (stopFailure) {
        throw new Error(
          `[ISOLATED-PG] Startup failed with: "${setupErr.message}". ` +
          `Subsequent cleanup also failed: "${stopFailure.message}"`
        );
      }
      throw setupErr;
    }
  }

  cleanupDataDir() {
    if (this.started) {
      throw new Error(`[ISOLATED-PG] SafetyError: Refusing to delete data directory while PostgreSQL instance is marked started.`);
    }
    const pidFile = this.dataDir ? path.join(this.dataDir, 'postmaster.pid') : null;
    if (pidFile && existsSync(pidFile)) {
      try {
        const parsed = parsePostmasterPid(readFileSync(pidFile, 'utf8'));
        if (parsed?.pid && isProcessAlive(parsed.pid)) {
          throw new Error(`[ISOLATED-PG] SafetyError: Refusing to delete data directory while PostgreSQL process (PID ${parsed.pid}) is alive.`);
        }
      } catch (e) {
        if (e.message.includes('SafetyError')) throw e;
      }
    }
    if (this.dataDir && existsSync(this.dataDir)) {
      rmSync(this.dataDir, { recursive: true, force: true });
    }
  }

  async stop(stopOptions = {}) {
    if (this.isExternal || !this.started) return;

    const timeoutMs = typeof stopOptions.timeoutMs === 'number' ? stopOptions.timeoutMs : 10000;
    const pidFile = this.dataDir ? path.join(this.dataDir, 'postmaster.pid') : null;
    let targetPid = null;

    if (pidFile && existsSync(pidFile)) {
      try {
        const pidContent = readFileSync(pidFile, 'utf8');
        const parsed = parsePostmasterPid(pidContent);
        if (parsed) {
          targetPid = parsed.pid;
          if (parsed.dataDir && this.dataDir) {
            if (canonicalizePath(parsed.dataDir) !== canonicalizePath(this.dataDir)) {
              throw new Error(
                `[ISOLATED-PG] ShutdownIdentityMismatchError: PID file indicates data directory "${parsed.dataDir}" ` +
                `which does not match instance data directory "${this.dataDir}". Refusing to stop unrelated server.`
              );
            }
          }
          if (parsed.port && this.port && Number(parsed.port) !== Number(this.port)) {
            throw new Error(
              `[ISOLATED-PG] ShutdownPortMismatchError: PID file indicates port ${parsed.port} ` +
              `which does not match instance port ${this.port}. Refusing to stop unrelated server.`
            );
          }
        }
      } catch (readErr) {
        if (readErr.message.includes('ShutdownIdentityMismatchError') || readErr.message.includes('ShutdownPortMismatchError')) {
          throw readErr;
        }
      }
    }

    if (this.options._simulateCleanupErrorOnStartupFailure || stopOptions._simulateCleanupError) {
      throw new Error('[TEST-SIMULATED] Simulated teardown error during server stop');
    }

    const simulateCmdFail = this.options._simulateShutdownCommandFailure || stopOptions._simulateShutdownCommandFailure;
    if (!simulateCmdFail) {
      const pgCtlBin = findPgBin('pg_ctl');
      if (pidFile && existsSync(pidFile)) {
        const stopRes = spawnSync(pgCtlBin, ['-D', this.dataDir, '-m', 'immediate', 'stop'], {
          encoding: 'utf8',
          timeout: 15000
        });
        if (stopRes.status !== 0) {
          console.warn(`[ISOLATED-PG] Warning: pg_ctl stop returned status ${stopRes.status}: ${stopRes.stderr || stopRes.stdout}`);
        }
      }
    }

    // Bounded polling for verified shutdown
    const startTime = Date.now();
    let isFullyStopped = false;
    let lastFailureReason = '';

    while (Date.now() - startTime < timeoutMs) {
      const simulatePidRemains = this.options._simulatePidFileRemains || stopOptions._simulatePidFileRemains;
      const pidFileExists = simulatePidRemains ? true : (pidFile ? existsSync(pidFile) : false);

      const processAlive = targetPid ? isProcessAlive(targetPid) : false;

      const simulatePortOccupied = this.options._simulatePortOccupied || stopOptions._simulatePortOccupied;
      const portOccupied = simulatePortOccupied ? true : (this.port ? await isPortOccupied(this.port) : false);

      if (!pidFileExists && !processAlive && !portOccupied) {
        isFullyStopped = true;
        break;
      }

      const reasons = [];
      if (pidFileExists) reasons.push('PID file still exists');
      if (processAlive) reasons.push(`process ${targetPid} still alive`);
      if (portOccupied) reasons.push(`port ${this.port} still occupied`);
      lastFailureReason = reasons.join(', ');

      await new Promise((r) => setTimeout(r, 100));
    }

    if (!isFullyStopped) {
      throw new Error(
        `[ISOLATED-PG] PostgresShutdownError: Failed to verify shutdown of PostgreSQL server on port ${this.port} ` +
        `within ${timeoutMs}ms. Remaining blockers: ${lastFailureReason}. Instance state remains started=true.`
      );
    }

    this.started = false;
  }
}
