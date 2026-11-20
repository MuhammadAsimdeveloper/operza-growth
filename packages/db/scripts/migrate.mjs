import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;

export const DEFAULT_MIGRATOR_PASSWORD = 'operza_migrator_secret';
export const DEFAULT_APP_PASSWORD = 'operza_app_secret';
export const DEFAULT_WORKER_PASSWORD = 'operza_worker_secret';

/**
 * Helper to strictly verify role security attributes fail-closed
 */
export async function verifyRolesAndAttributes(queryable) {
  const roleRes = await queryable.query(`
    SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit
    FROM pg_roles
    WHERE rolname IN ('operza_app', 'operza_worker', 'operza_migrator', 'operza_auth_definer')
    ORDER BY rolname;
  `);

  if (roleRes.rowCount !== 4) {
    throw new Error(`[BOOTSTRAP-CHECK] Required 4 roles, found ${roleRes.rowCount}`);
  }

  const roleMap = new Map(roleRes.rows.map(r => [r.rolname, r]));
  for (const expectedRole of ['operza_app', 'operza_worker', 'operza_migrator', 'operza_auth_definer']) {
    if (!roleMap.has(expectedRole)) {
      throw new Error(`[BOOTSTRAP-CHECK] Missing role "${expectedRole}" in pg_roles.`);
    }
  }

  for (const [name, row] of roleMap.entries()) {
    if (row.rolsuper) throw new Error(`[BOOTSTRAP-CHECK] ${name} must NOT be superuser`);
    if (row.rolcreatedb) throw new Error(`[BOOTSTRAP-CHECK] ${name} must NOT have CREATEDB`);
    if (row.rolcreaterole) throw new Error(`[BOOTSTRAP-CHECK] ${name} must NOT have CREATEROLE`);
    if (row.rolinherit) throw new Error(`[BOOTSTRAP-CHECK] ${name} must have NOINHERIT`);

    if (name === 'operza_auth_definer') {
      if (!row.rolbypassrls) throw new Error('[BOOTSTRAP-CHECK] operza_auth_definer must have BYPASSRLS');
      if (row.rolcanlogin) throw new Error('[BOOTSTRAP-CHECK] operza_auth_definer must have NOLOGIN');
    } else {
      if (row.rolbypassrls) throw new Error(`[BOOTSTRAP-CHECK] ${name} must NOT have BYPASSRLS`);
      if (!row.rolcanlogin) throw new Error(`[BOOTSTRAP-CHECK] ${name} must have LOGIN permission`);
    }
  }

  // Verify role membership: operza_migrator must be member of operza_auth_definer
  const memberRes = await queryable.query(`
    SELECT pg_has_role('operza_migrator', 'operza_auth_definer', 'MEMBER') AS is_member;
  `);
  if (!memberRes.rows[0]?.is_member) {
    throw new Error('[BOOTSTRAP-CHECK] operza_migrator must be a member of operza_auth_definer');
  }
}

/**
 * Stage A — Privileged Bootstrap
 * Executed with an administrative / superuser connection.
 * Provisions extensions, global security roles, baseline schema grants,
 * event triggers for RLS template seeding, and asserts exact role attributes.
 */
export async function runPrivilegedBootstrap(adminPool, options = {}) {
  const migratorPassword = options.migratorPassword || process.env.OPERZA_MIGRATOR_PASSWORD || process.env.MIGRATOR_PASSWORD || DEFAULT_MIGRATOR_PASSWORD;
  const appPassword = options.appPassword || process.env.OPERZA_APP_PASSWORD || DEFAULT_APP_PASSWORD;
  const workerPassword = options.workerPassword || process.env.OPERZA_WORKER_PASSWORD || DEFAULT_WORKER_PASSWORD;

  console.log('[STAGE-A] Verifying administrative connection identity...');
  const identRes = await adminPool.query(`
    SELECT current_user, rolsuper, rolcreaterole
    FROM pg_roles
    WHERE rolname = current_user
  `);
  if (!identRes.rowCount) {
    throw new Error('[STAGE-A] FATAL: Unable to resolve current_user identity in pg_roles.');
  }

  const adminRole = identRes.rows[0];
  console.log(`[STAGE-A] Authenticated as "${adminRole.current_user}" (superuser=${adminRole.rolsuper}, createrole=${adminRole.rolcreaterole})`);

  if (!adminRole.rolsuper && !adminRole.rolcreaterole) {
    throw new Error(`[STAGE-A] PRIVILEGE_ERROR: Admin user "${adminRole.current_user}" lacks SUPERUSER or CREATEROLE. Cannot perform bootstrap.`);
  }

  // 1. Extensions
  await adminPool.query('CREATE EXTENSION IF NOT EXISTS btree_gist;');

  // 2. Roles
  await adminPool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_auth_definer') THEN
        CREATE ROLE operza_auth_definer NOLOGIN NOINHERIT BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_migrator') THEN
        CREATE ROLE operza_migrator LOGIN PASSWORD '${migratorPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      ELSE
        ALTER ROLE operza_migrator WITH PASSWORD '${migratorPassword}';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_app') THEN
        CREATE ROLE operza_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_worker') THEN
        CREATE ROLE operza_worker LOGIN PASSWORD '${workerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      END IF;
    END $$;
  `);

  // 3. Database & Schema Privileges
  const dbRes = await adminPool.query('SELECT current_database() AS dbname');
  const dbName = dbRes.rows[0].dbname;

  await adminPool.query(`
    GRANT ALL ON DATABASE "${dbName}" TO operza_migrator;
    GRANT CONNECT ON DATABASE "${dbName}" TO operza_app, operza_worker;
    GRANT ALL ON SCHEMA public TO operza_migrator;
    GRANT USAGE, CREATE ON SCHEMA public TO operza_auth_definer;
    GRANT USAGE ON SCHEMA public TO operza_app, operza_worker;
    GRANT operza_auth_definer TO operza_migrator;

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

  // 4. Verify roles and attributes
  await verifyRolesAndAttributes(adminPool);
  console.log('[STAGE-A] ✓ Privileged bootstrap verified successfully.');
}

/**
 * Stage B — Unprivileged Migration Execution
 * Authenticated strictly as operza_migrator.
 * Asserts NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOINHERIT.
 * Executes migrations in sequence without falling back to superuser.
 */
export async function runUnprivilegedMigrations(migratorPool, options = {}) {
  const root = options.root || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const directory = options.directory || path.join(root, 'migrations');

  console.log('[STAGE-B] Verifying unprivileged migration runner connection identity...');
  const identRes = await migratorPool.query(`
    SELECT current_user, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin
    FROM pg_roles
    WHERE rolname = current_user
  `);

  if (!identRes.rowCount) {
    throw new Error('[STAGE-B] FATAL: Unable to resolve current_user identity in pg_roles.');
  }

  const ident = identRes.rows[0];
  if (ident.current_user !== 'operza_migrator') {
    throw new Error(`[STAGE-B] IDENTITY_VIOLATION: Expected current_user to be "operza_migrator", got "${ident.current_user}"`);
  }
  if (ident.rolsuper) {
    throw new Error('[STAGE-B] SECURITY_VIOLATION: operza_migrator must NOT be superuser');
  }
  if (ident.rolbypassrls) {
    throw new Error('[STAGE-B] SECURITY_VIOLATION: operza_migrator must NOT have BYPASSRLS');
  }
  if (ident.rolcreatedb) {
    throw new Error('[STAGE-B] SECURITY_VIOLATION: operza_migrator must NOT have CREATEDB');
  }
  if (ident.rolcreaterole) {
    throw new Error('[STAGE-B] SECURITY_VIOLATION: operza_migrator must NOT have CREATEROLE');
  }
  if (ident.rolinherit) {
    throw new Error('[STAGE-B] SECURITY_VIOLATION: operza_migrator must have NOINHERIT');
  }
  if (!ident.rolcanlogin) {
    throw new Error('[STAGE-B] SECURITY_VIOLATION: operza_migrator must have LOGIN permission');
  }

  const memberRes = await migratorPool.query(`
    SELECT pg_has_role(current_user, 'operza_auth_definer', 'MEMBER') AS is_member
  `);
  if (!memberRes.rows[0]?.is_member) {
    throw new Error('[STAGE-B] SECURITY_VIOLATION: operza_migrator must be granted membership in operza_auth_definer');
  }

  console.log(`[STAGE-B] Verified migration runner "${ident.current_user}" attributes: NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOINHERIT.`);

  // Negative test: verify operza_migrator cannot create roles
  let createRoleFailed = false;
  try {
    await migratorPool.query('CREATE ROLE __unauthorized_probe_role;');
  } catch (err) {
    createRoleFailed = true;
  }
  if (!createRoleFailed) {
    throw new Error('[STAGE-B] SECURITY_VIOLATION: operza_migrator was able to create roles! NOCREATEROLE violated.');
  }

  // 1. Ensure schema_migrations table exists and is isolated
  await migratorPool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  await migratorPool.query('REVOKE ALL ON TABLE schema_migrations FROM operza_app, operza_worker').catch(() => {});

  // 2. Scan and sort migrations
  const names = (await readdir(directory))
    .filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();

  console.log(`[STAGE-B] Found ${names.length} migration files in sequence.`);

  for (const name of names) {
    const client = await migratorPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [741029181]);
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
      if (applied.rowCount) {
        await client.query('COMMIT');
        continue;
      }
      const sql = await readFile(path.join(directory, name), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log(`[STAGE-B] ✓ Applied ${name} as operza_migrator`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[STAGE-B] ✗ Failed executing ${name} as operza_migrator:`, error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  console.log('[STAGE-B] All migrations applied successfully under operza_migrator.');
}

/**
 * End-to-end migration pipeline coordinating Stage A and Stage B.
 * NEVER falls back to superuser during Stage B.
 */
export async function runMigrationPipeline(options = {}) {
  const adminUrl = options.adminUrl || process.env.ADMIN_DATABASE_URL || process.env.MIGRATION_ADMIN_URL || process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || process.env.OPERZA_TEST_DATABASE_URL;

  if (!adminUrl) {
    throw new Error('[MIGRATION] Error: Set ADMIN_DATABASE_URL, MIGRATION_DATABASE_URL, DATABASE_URL, or OPERZA_TEST_DATABASE_URL.');
  }

  const migratorPassword = options.migratorPassword || process.env.OPERZA_MIGRATOR_PASSWORD || process.env.MIGRATOR_PASSWORD || DEFAULT_MIGRATOR_PASSWORD;
  const ssl = (process.env.PGSSL === 'true' || options.ssl) ? { rejectUnauthorized: true } : undefined;

  // Execute Stage A (Privileged Bootstrap)
  const adminPool = new Pool({
    connectionString: adminUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
    ssl
  });

  try {
    await runPrivilegedBootstrap(adminPool, { ...options, migratorPassword });
  } finally {
    await adminPool.end();
  }

  // Derive unprivileged operza_migrator connection URL
  let migratorUrl = options.migratorUrl || process.env.MIGRATOR_DATABASE_URL;
  if (!migratorUrl) {
    const parsed = new URL(adminUrl);
    parsed.username = 'operza_migrator';
    parsed.password = migratorPassword;
    migratorUrl = parsed.toString();
  }

  // Execute Stage B (Unprivileged Migration Execution) strictly as operza_migrator
  const migratorPool = new Pool({
    connectionString: migratorUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
    ssl
  });

  try {
    await runUnprivilegedMigrations(migratorPool, options);
  } finally {
    await migratorPool.end();
  }
}

// CLI entrypoint execution
const isMain = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
);

if (isMain) {
  runMigrationPipeline()
    .then(() => {
      console.log('[MIGRATION] Migration process completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[MIGRATION] Fatal migration error:', err.message);
      process.exit(1);
    });
}
