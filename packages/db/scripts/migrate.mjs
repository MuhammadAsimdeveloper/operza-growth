import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Auto-load root .env if present
try {
  if (typeof process.loadEnvFile === 'function') {
    const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
    process.loadEnvFile(path.join(root, '.env'));
  }
} catch {
  // Gracefully continue if .env does not exist
}

const { Pool } = pg;
const migrationUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;

if (!migrationUrl) {
  console.error('❌ Set MIGRATION_DATABASE_URL (or DATABASE_URL) to a PostgreSQL migration-owner connection.');
  process.exitCode = 1;
} else {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const directory = path.join(root, 'migrations');
  const pool = new Pool({
    connectionString: migrationUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined
  });

  try {
    // 1. Ensure schema_migrations table exists with checksum tracking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Ensure operza_app cannot tamper with migration logs
    const appRoleExists = (await pool.query("SELECT 1 FROM pg_roles WHERE rolname='operza_app'")).rowCount;
    if (appRoleExists) {
      await pool.query('REVOKE ALL ON TABLE schema_migrations FROM operza_app');
    }

    const files = (await readdir(directory))
      .filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .sort();

    for (const name of files) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [741029181]);

        const content = await readFile(path.join(directory, name), 'utf8');
        const checksum = createHash('sha256').update(content).digest('hex');

        const applied = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
        if (applied.rowCount > 0) {
          const recorded = applied.rows[0].checksum;
          if (recorded && recorded !== checksum) {
            console.warn(`⚠️ Warning: Migration ${name} checksum mismatch (recorded: ${recorded.slice(0, 8)}, current: ${checksum.slice(0, 8)})`);
          }
          await client.query('COMMIT');
          continue;
        }

        await client.query(content);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum, applied_at) VALUES ($1, $2, now())',
          [name, checksum]
        );
        await client.query('COMMIT');
        console.log(`✅ Applied migration ${name} [${checksum.slice(0, 8)}]`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
    console.log('🎉 All PostgreSQL database migrations successfully applied.');
  } catch (error) {
    console.error('❌ Migration execution failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
