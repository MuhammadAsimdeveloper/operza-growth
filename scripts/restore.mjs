/**
 * ==============================================================================
 * Operza Production Database & State Restoration Utility
 * ==============================================================================
 * Validates cryptographic checksums, restores PostgreSQL database tables,
 * and recovers application state snapshots.
 * ==============================================================================
 */

import { execSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backupManifestArg = process.argv[2];

async function runRestore() {
  if (!backupManifestArg) {
    console.error('❌ Usage: node scripts/restore.mjs <path-to-manifest.json>');
    process.exit(1);
  }

  const manifestPath = path.resolve(process.cwd(), backupManifestArg);
  console.log(`🔍 [OPERZA-RESTORE] Reading backup manifest: ${manifestPath}`);

  const rawManifest = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(rawManifest);
  const backupDir = path.dirname(manifestPath);

  console.log(`📋 Manifest ID: ${manifest.id}`);
  console.log(`⏰ Timestamp: ${manifest.timestamp}`);
  console.log(`📦 Artifacts to restore: ${manifest.artifacts.length}`);

  for (const artifact of manifest.artifacts) {
    const artifactPath = path.join(backupDir, artifact.file);
    const fileBytes = await readFile(artifactPath);
    const actualHash = createHash('sha256').update(fileBytes).digest('hex');

    if (actualHash !== artifact.sha256) {
      throw new Error(`CRITICAL INTEGRITY FAILURE: Artifact ${artifact.file} checksum mismatch! Expected ${artifact.sha256}, got ${actualHash}`);
    }
    console.log(`🔒 Checksum verified: ${artifact.file} [SHA-256: ${actualHash.slice(0, 8)}]`);

    if (artifact.kind === 'postgres_sql') {
      if (!process.env.DATABASE_URL && !process.env.MIGRATION_DATABASE_URL) {
        console.warn('⚠️ Skipping PostgreSQL restore: DATABASE_URL not set.');
        continue;
      }
      const targetUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
      console.log('🐘 Restoring PostgreSQL database from SQL dump...');
      try {
        execSync(`psql "${targetUrl}" < "${artifactPath}"`, { stdio: 'inherit' });
        console.log('✅ PostgreSQL database restored successfully.');
      } catch (err) {
        console.error('❌ Failed restoring PostgreSQL SQL dump:', err.message);
        throw err;
      }
    } else if (artifact.kind === 'application_state_json') {
      const storeTarget = path.resolve(root, 'data/store.json');
      await writeFile(storeTarget, fileBytes);
      console.log(`✅ Application state restored to ${storeTarget}`);
    }
  }

  console.log('🎉 [OPERZA-RESTORE] Complete restoration successfully executed and verified.');
}

runRestore().catch((err) => {
  console.error('❌ Restoration failed:', err.message);
  process.exit(1);
});
