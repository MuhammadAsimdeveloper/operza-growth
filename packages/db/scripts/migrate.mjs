import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const migrationUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || process.env.OPERZA_TEST_DATABASE_URL;

if (!migrationUrl) {
  console.error('[MIGRATION] Error: Set MIGRATION_DATABASE_URL, DATABASE_URL, or OPERZA_TEST_DATABASE_URL to a PostgreSQL connection.');
  process.exit(1);
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.join(root, 'migrations');
const pool = new Pool({
  connectionString: migrationUrl,
  max: 1,
  connectionTimeoutMillis: 5000,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined
});

try {
  console.log('[MIGRATION] Connected to PostgreSQL. Verifying bootstrap roles and extensions...');
  
  // 1. Ensure required extensions and baseline security roles exist
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
      EXECUTE format('GRANT operza_auth_definer TO %I', current_user);
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;
  `);

  // 2. Ensure schema_migrations table exists and is isolated from operza_app
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  if ((await pool.query("SELECT 1 FROM pg_roles WHERE rolname='operza_app'")).rowCount) {
    await pool.query('REVOKE ALL ON TABLE schema_migrations FROM operza_app');
  }

  // 3. Scan and sort migrations deterministically
  const names = (await readdir(directory))
    .filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();

  console.log(`[MIGRATION] Found ${names.length} migration files in sequence.`);

  for (const name of names) {
    const client = await pool.connect();
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
      console.log(`[MIGRATION] ✓ Applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[MIGRATION] ✗ Failed executing ${name}:`, error.message);
      throw error;
    } finally {
      client.release();
    }
  }
  console.log('[MIGRATION] All migrations applied successfully.');
} catch (error) {
  console.error('[MIGRATION] Fatal migration error:', error.message);
  process.exit(1);
} finally {
  await pool.end();
}
