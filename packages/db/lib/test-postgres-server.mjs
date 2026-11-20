import { spawn, spawnSync, execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    if (!/^[a-zA-Z0-9_]{1,63}$/.test(this.dbName)) {
      throw new Error(`Invalid dbName "${this.dbName}". Must be 1-63 alphanumeric/underscore characters.`);
    }
    this.dataDir = options.dataDir || path.join(root, 'scratch', `test-shared-pg-cluster-${this.port}`);
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

    mkdirSync(path.dirname(this.dataDir), { recursive: true });

    // 1. Run initdb if cluster is not yet initialized or if version mismatch
    const pgVersionFile = path.join(this.dataDir, 'PG_VERSION');
    const binVerRes = spawnSync(initdbBin, ['--version'], { encoding: 'utf8' });
    const match = (binVerRes.stdout || '').match(/(\d+)/);
    const binMajor = match ? match[1] : '16';

    if (existsSync(pgVersionFile)) {
      const existingVer = readFileSync(pgVersionFile, 'utf8').trim();
      if (existingVer !== binMajor) {
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

    // 4. Bootstrap extensions and roles (skipped when testing clean Stage A bootstrap)
    if (!this.skipRoleBootstrap) {
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
