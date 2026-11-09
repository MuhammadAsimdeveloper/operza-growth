import { spawn, spawnSync, execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');

const DEFAULT_BIN_DIRS = [
  'C:\\Program Files\\PostgreSQL\\18\\bin',
  'C:\\Program Files\\PostgreSQL\\17\\bin',
  'C:\\Program Files\\PostgreSQL\\16\\bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/bin'
];

function findPgBin(name) {
  for (const binDir of DEFAULT_BIN_DIRS) {
    const full = path.join(binDir, process.platform === 'win32' ? `${name}.exe` : name);
    if (existsSync(full)) return full;
  }
  return process.platform === 'win32' ? `${name}.exe` : name;
}

export class IsolatedTestPostgres {
  constructor(options = {}) {
    this.port = options.port || 5433;
    this.dbName = options.dbName || 'operza_test';
    this.dataDir = options.dataDir || path.join(root, 'scratch', 'test-shared-pg-cluster');
    this.started = false;
    this.isExternal = false;
  }

  async start() {
    if (process.env.OPERZA_TEST_DATABASE_URL) {
      this.isExternal = true;
      this.connectionUrl = process.env.OPERZA_TEST_DATABASE_URL;
      return this.connectionUrl;
    }

    const initdbBin = findPgBin('initdb');
    const pgCtlBin = findPgBin('pg_ctl');
    const psqlBin = findPgBin('psql');

    mkdirSync(path.dirname(this.dataDir), { recursive: true });

    // 1. Run initdb only if cluster is not yet initialized
    if (!existsSync(path.join(this.dataDir, 'PG_VERSION'))) {
      const initRes = spawnSync(initdbBin, ['-D', this.dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '-N'], {
        encoding: 'utf8',
        timeout: 120000
      });
      if (initRes.status !== 0) {
        throw new Error(`initdb failed: ${initRes.stderr || initRes.stdout}`);
      }
    }

    // 2. Probe if already running on this.port
    const probeRes = spawnSync(psqlBin, ['-U', 'postgres', '-h', '127.0.0.1', '-p', String(this.port), '-c', 'SELECT 1;'], {
      encoding: 'utf8',
      timeout: 3000
    });

    if (probeRes.status !== 0) {
      // Start pg_ctl on isolated port
      const logFile = path.join(this.dataDir, 'server.log');
      const startRes = spawnSync(pgCtlBin, ['-D', this.dataDir, '-o', `-p ${this.port} -F`, '-l', logFile, 'start'], {
        encoding: 'utf8',
        timeout: 20000
      });
      if (startRes.status !== 0) {
        throw new Error(`pg_ctl start failed: ${startRes.stderr || startRes.stdout}`);
      }
      this.started = true;
    }

    // 3. Re-create isolated test database using maintenance template1 database
    spawnSync(psqlBin, ['-U', 'postgres', '-h', '127.0.0.1', '-p', String(this.port), '-d', 'template1', '-c', `DROP DATABASE IF EXISTS "${this.dbName}";`], { encoding: 'utf8' });
    const createRes = spawnSync(psqlBin, ['-U', 'postgres', '-h', '127.0.0.1', '-p', String(this.port), '-d', 'template1', '-c', `CREATE DATABASE "${this.dbName}";`], { encoding: 'utf8' });
    if (createRes.status !== 0) {
      throw new Error(`Failed to create database ${this.dbName}: ${createRes.stderr || createRes.stdout}`);
    }

    this.connectionUrl = `postgresql://postgres@127.0.0.1:${this.port}/${this.dbName}`;

    // 4. Bootstrap extensions and roles
    const { default: pg } = await import('pg');
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
        END $$;
      `);
      await pool.query('GRANT ALL ON DATABASE ' + this.dbName + ' TO postgres, operza_migrator, operza_app;');
      await pool.query('GRANT USAGE, CREATE ON SCHEMA public TO postgres, operza_migrator, operza_app;');
    } finally {
      await pool.end();
    }

    return this.connectionUrl;
  }

  async stop() {
    if (this.isExternal || !this.started) return;
    const pgCtlBin = findPgBin('pg_ctl');
    spawnSync(pgCtlBin, ['-D', this.dataDir, '-m', 'immediate', 'stop'], {
      encoding: 'utf8',
      timeout: 10000
    });
    this.started = false;
  }
}
