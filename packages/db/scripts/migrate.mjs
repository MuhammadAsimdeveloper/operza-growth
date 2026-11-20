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

  // Acquire dedicated client to guarantee session affinity for session-scoped temporary objects
  const isDedicatedPool = typeof adminPool.connect === 'function';
  const client = isDedicatedPool ? await adminPool.connect() : adminPool;
  let bootstrapError = null;

  try {
    const identRes = await client.query(`
      SELECT current_user, rolsuper, rolcreaterole
      FROM pg_roles
      WHERE rolname = current_user
    `);
    if (!identRes.rowCount) {
      throw new Error('[STAGE-A] FATAL: Unable to resolve current_user identity in pg_roles.');
    }

    const adminRole = identRes.rows[0];
    console.log(`[STAGE-A] Authenticated as "${adminRole.current_user}" (superuser=${adminRole.rolsuper}, createrole=${adminRole.rolcreaterole})`);

    // Stage A requires SUPERUSER privileges (needed for CREATE EXTENSION btree_gist and CREATE EVENT TRIGGER)
    if (!adminRole.rolsuper) {
      throw new Error(
        `[STAGE-A] PRIVILEGE_ERROR: Administrative user "${adminRole.current_user}" lacks SUPERUSER privileges. ` +
        `Stage A bootstrap requires SUPERUSER to install the "btree_gist" extension, create event triggers, and provision global security roles.`
      );
    }

    // 1. Extensions
    await client.query('CREATE EXTENSION IF NOT EXISTS btree_gist;');

    // 2. Roles: provision via parameterized PL/pgSQL session function to eliminate unsafe SQL interpolation
    // Constrain role options and role names strictly to predefined configurations
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_auth_definer') THEN
          CREATE ROLE operza_auth_definer NOLOGIN NOINHERIT BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;

      CREATE OR REPLACE FUNCTION pg_temp.provision_security_role(
        p_role text,
        p_password text,
        p_options text
      )
      RETURNS void
      LANGUAGE plpgsql
      AS $fn$
      DECLARE
        v_normalized_options text;
      BEGIN
        -- Constrain role names strictly to approved Operza runtime and migrator identities
        IF p_role NOT IN ('operza_migrator', 'operza_app', 'operza_worker') THEN
          RAISE EXCEPTION 'Disallowed role name "%": pg_temp.provision_security_role only provisions predefined Operza roles', p_role
            USING ERRCODE = '42501';
        END IF;

        -- Constrain role options strictly to exact predefined least-privilege configurations
        v_normalized_options := upper(trim(regexp_replace(p_options, '\\s+', ' ', 'g')));
        IF v_normalized_options <> 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS' THEN
          RAISE EXCEPTION 'Disallowed role options "%": options must be strictly "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"', p_options
            USING ERRCODE = '42501';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_role) THEN
          EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L %s', p_role, p_password, v_normalized_options);
        ELSE
          EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', p_role, p_password);
        END IF;
      END;
      $fn$;
    `);

    const standardRoleOptions = 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS';

    await client.query('SELECT pg_temp.provision_security_role($1, $2, $3);', [
      'operza_migrator',
      migratorPassword,
      standardRoleOptions
    ]);
    await client.query('SELECT pg_temp.provision_security_role($1, $2, $3);', [
      'operza_app',
      appPassword,
      standardRoleOptions
    ]);
    await client.query('SELECT pg_temp.provision_security_role($1, $2, $3);', [
      'operza_worker',
      workerPassword,
      standardRoleOptions
    ]);

    // 3. Database & Schema Privileges
    const dbRes = await client.query('SELECT current_database() AS dbname');
    const dbName = dbRes.rows[0].dbname;

    await client.query(`
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

    // 4. Verify roles and attributes using the dedicated client session
    await verifyRolesAndAttributes(client);
    console.log('[STAGE-A] ✓ Privileged bootstrap verified successfully.');
  } catch (err) {
    bootstrapError = err;
    throw err;
  } finally {
    if (client && isDedicatedPool && typeof client.release === 'function') {
      try {
        client.release();
      } catch (releaseErr) {
        console.error('[STAGE-A] Error releasing admin client during cleanup:', releaseErr);
        if (!bootstrapError) {
          throw releaseErr;
        }
      }
    }
  }
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

  // Active exact probe: verify operza_migrator cannot create roles (assert exact SQLSTATE 42501 insufficient_privilege)
  const probeRoleName = `__probe_unauthorized_role_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let probeSucceeded = false;
  let probeError = null;

  try {
    await migratorPool.query(`CREATE ROLE ${probeRoleName};`);
    probeSucceeded = true;
  } catch (err) {
    probeError = err;
  }

  if (probeSucceeded) {
    if (options.adminPool) {
      await options.adminPool.query(`DROP ROLE IF EXISTS ${probeRoleName};`).catch(() => {});
    }
    throw new Error(
      `[STAGE-B] SECURITY_VIOLATION: Migration runner "${ident.current_user}" was able to execute CREATE ROLE "${probeRoleName}". ` +
      'NOCREATEROLE boundary was violated!'
    );
  }

  if (!probeError || probeError.code !== '42501') {
    throw new Error(
      `[STAGE-B] NOCREATEROLE_PROBE_FAILED: Expected SQLSTATE 42501 (insufficient_privilege) during NOCREATEROLE probe, ` +
      `got ${probeError?.code || 'UNKNOWN'} (${probeError?.message || 'No error thrown'}).`
    );
  }

  // 1. Ensure schema_migrations table exists and is isolated
  await migratorPool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  // Revocation must execute without silent suppression
  await migratorPool.query('REVOKE ALL ON TABLE schema_migrations FROM operza_app, operza_worker;');

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
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error(`[STAGE-B] Transaction rollback error while handling migration failure: ${rollbackErr.message}`);
      }
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
    await runUnprivilegedMigrations(migratorPool, { ...options, adminPool: null });
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
