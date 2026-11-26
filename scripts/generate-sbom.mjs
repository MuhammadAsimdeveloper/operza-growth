/**
 * Phase 8 — CycloneDX 1.5 SBOM Generator from package-lock.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

const components = [];
const dependencies = [];

for (const [pkgPath, meta] of Object.entries(lock.packages || {})) {
  if (!pkgPath || !meta.version) continue;
  const name = meta.name || pkgPath.replace(/^.*node_modules\//, '');
  const purl = `pkg:npm/${name.replace(/^@/, '%40')}@${meta.version}`;
  components.push({
    type: 'library',
    'bom-ref': purl,
    name,
    version: meta.version,
    purl,
    scope: meta.dev ? 'optional' : 'required',
    ...(meta.license ? { licenses: [{ license: { id: meta.license } }] } : {})
  });
  if (meta.dependencies) {
    dependencies.push({
      ref: purl,
      dependsOn: Object.keys(meta.dependencies)
    });
  }
}

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: 'application',
      name: lock.name || 'operza',
      version: lock.version || '1.0.0'
    }
  },
  components,
  dependencies
};

const outPath = path.join(ROOT, 'docs/PHASE_8/sbom-cyclonedx.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(sbom, null, 2));
console.log(`[SBOM] Generated ${components.length} CycloneDX 1.5 components -> ${outPath}`);
