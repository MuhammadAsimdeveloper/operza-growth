import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import YAML from 'yaml';

const ROOT = process.cwd();

async function collectFiles(dir, ext) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await collectFiles(full, ext)));
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
}

// 1. Validate Terraform files & security invariants
const tfFiles = await collectFiles(path.join(ROOT, 'infra/terraform'), '.tf');
assert.ok(tfFiles.length >= 12, `Expected >=12 .tf files, found ${tfFiles.length}`);

let allTf = '';
for (const file of tfFiles) {
  const content = await readFile(file, 'utf8');
  allTf += `\n# ${file}\n${content}`;
  // Brace balance check
  const open = (content.match(/\{/g) || []).length;
  const close = (content.match(/\}/g) || []).length;
  assert.equal(open, close, `Unbalanced braces in ${file}: {=${open}, }=${close}`);
  // No embedded secrets
  assert.ok(!/sk_live_|AKIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|PRIVATE) KEY-----/.test(content), `Potential secret in ${file}`);
}

assert.ok(allTf.includes('publicly_accessible             = false'), 'RDS must set publicly_accessible = false');
assert.ok(allTf.includes('transit_encryption_enabled = true'), 'Redis must enable transit encryption');
assert.ok(allTf.includes('at_rest_encryption_enabled = true'), 'Redis must enable at-rest encryption');
assert.ok(allTf.includes('block_public_acls       = true'), 'S3 must block public ACLs');
assert.ok(allTf.includes('enable_key_rotation     = true'), 'KMS key must enable rotation');
assert.ok(!allTf.includes('"*"'), 'IAM policies must not use wildcard "*" actions/resources');

// 2. Validate GitHub Actions YAML workflows
const wfFiles = await collectFiles(path.join(ROOT, '.github/workflows'), '.yml');
assert.ok(wfFiles.length >= 4, `Expected >=4 workflow files, found ${wfFiles.length}`);
for (const wf of wfFiles) {
  const doc = YAML.parse(await readFile(wf, 'utf8'));
  assert.ok(doc && doc.jobs, `Invalid workflow YAML: ${wf}`);
}

// 3. Validate docker-compose.staging.yml
const compose = YAML.parse(await readFile(path.join(ROOT, 'docker-compose.staging.yml'), 'utf8'));
assert.ok(compose.services?.['worker-1']?.environment?.WORKER_DATABASE_URL, 'worker-1 must receive WORKER_DATABASE_URL');
assert.ok(compose.services?.['worker-1']?.environment?.OPERZA_VAULT_KEY, 'worker-1 must receive OPERZA_VAULT_KEY');
assert.equal(compose.services?.api?.environment?.DISTRIBUTED_RATE_LIMIT_STRICT, 'true', 'api staging must enforce DISTRIBUTED_RATE_LIMIT_STRICT=true');

console.log(`✅ Validated ${tfFiles.length} Terraform files, ${wfFiles.length} GitHub workflows, and docker-compose.staging.yml cleanly.`);
