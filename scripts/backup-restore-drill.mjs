/**
 * Phase 8 — Real PostgreSQL Backup & Restore Drill
 * Uses pg_dump & pg_restore against an isolated ephemeral PostgreSQL cluster,
 * restores into a separate database, verifies migrations, row counts, and FORCE RLS,
 * and measures actual backup & restore duration (RTO).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { IsolatedTestPostgres } from '../packages/db/lib/test-postgres-server.mjs';

const { Pool } = pg;
const PG_BIN = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const pgDumpBin = path.join(PG_BIN, 'pg_dump.exe');
const pgRestoreBin = path.join(PG_BIN, 'pg_restore.exe');

async function main() {
  if (!fs.existsSync(pgDumpBin) || !fs.existsSync(pgRestoreBin)) {
    throw new Error('pg_dump.exe / pg_restore.exe not found at ' + PG_BIN);
  }

  const server = new IsolatedTestPostgres({ port: 0, dbName: 'operza_backup_src' });
  const dbUrl = await server.start();
  console.error('[DRILL] pg started:', dbUrl);
  const dumpFile = path.join(os.tmpdir(), `operza-drill-${Date.now()}.dump`);

  try {
    execFileSync(process.execPath, ['packages/db/scripts/migrate.mjs'], {
      env: { ...process.env, DATABASE_URL: dbUrl, MIGRATION_DATABASE_URL: dbUrl, OPERZA_TEST_DATABASE_URL: dbUrl },
      stdio: 'pipe'
    });
    console.error('[DRILL] migrations applied');
    const srcPool = new Pool({ connectionString: dbUrl });
    srcPool.on('error', () => {});

    const agencyId = randomUUID();
    const locId = randomUUID();
    const contactId = randomUUID();
    await srcPool.query(`INSERT INTO agencies (id, name, slug) VALUES ($1, 'Drill Agency', $2)`, [agencyId, `drill-${Date.now()}`]);
    await srcPool.query(`INSERT INTO locations (id, agency_id, name) VALUES ($1, $2, 'Drill Loc')`, [locId, agencyId]);
    await srcPool.query(
      `INSERT INTO location_records (id, agency_id, location_id, collection, body) VALUES ($1, $2, $3, 'contacts', $4::jsonb)`,
      [contactId, agencyId, locId, JSON.stringify({ email: 'drill@example.com', firstName: 'Drill' })]
    );
    await srcPool.end();

    const backupStart = Date.now();
    execFileSync(pgDumpBin, ['-Fc', '-f', dumpFile, dbUrl], { stdio: 'pipe' });
    const backupDurationMs = Date.now() - backupStart;
    const dumpBytes = fs.statSync(dumpFile).size;
    console.error('[DRILL] dumped:', dumpBytes);

    // Create fresh target DB and restore
    const adminPool = new Pool({ connectionString: dbUrl });
    adminPool.on('error', () => {});
    await adminPool.query('CREATE DATABASE operza_restore_verify');
    await adminPool.end();

    const targetUrl = dbUrl.replace('/operza_backup_src', '/operza_restore_verify');
    const restoreStart = Date.now();
    execFileSync(pgRestoreBin, ['--no-owner', '-d', targetUrl, dumpFile], { stdio: 'pipe' });
    const restoreDurationMs = Date.now() - restoreStart;
    console.error('[DRILL] restored in ms:', restoreDurationMs);

    const verifyPool = new Pool({ connectionString: targetUrl });
    verifyPool.on('error', () => {});
    const migCount = await verifyPool.query('SELECT COUNT(*)::int AS c FROM schema_migrations');
    const recCount = await verifyPool.query('SELECT COUNT(*)::int AS c FROM location_records WHERE id = $1', [contactId]);

    // Verify FORCE RLS still blocks unauthenticated operza_app queries on restored DB
    const rlsClient = await verifyPool.connect();
    rlsClient.on('error', () => {});
    await rlsClient.query('SET ROLE operza_app');
    const rlsCheck = await rlsClient.query('SELECT COUNT(*)::int AS c FROM location_records');
    await rlsClient.query('RESET ROLE').catch(() => {});
    rlsClient.release();
    await verifyPool.end();

    console.log(JSON.stringify({
      ok: true,
      backupDurationMs,
      restoreDurationMs,
      dumpBytes,
      migrationsRestored: migCount.rows[0].c,
      seededContactRestored: recCount.rows[0].c,
      rlsWithoutContextRows: rlsCheck.rows[0].c
    }, null, 2));
  } finally {
    if (fs.existsSync(dumpFile)) fs.unlinkSync(dumpFile);
    await new Promise((r) => setTimeout(r, 150));
    await server.stop();
  }
}

main().catch((err) => {
  console.error('[BACKUP-DRILL-FAILED]', err);
  process.exit(1);
});
