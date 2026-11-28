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
assert.ok(!allTf.includes('ACCOUNT_ID'), 'IAM OIDC trust must not contain literal ACCOUNT_ID placeholder');

// 2. Validate GitHub Actions YAML workflows
const wfFiles = await collectFiles(path.join(ROOT, '.github/workflows'), '.yml');
assert.ok(wfFiles.length >= 5, `Expected >=5 workflow files, found ${wfFiles.length}`);
for (const wf of wfFiles) {
  const doc = YAML.parse(await readFile(wf, 'utf8'));
  assert.ok(doc && doc.jobs, `Invalid workflow YAML: ${wf}`);
}

// 2b. Verify infra-validation.yml safety boundaries (no AWS creds, no apply, no push)
const infraWfRaw = await readFile(path.join(ROOT, '.github/workflows/infra-validation.yml'), 'utf8');
const infraWf = YAML.parse(infraWfRaw);
assert.equal(infraWf.permissions?.contents, 'read', 'infra-validation.yml must restrict contents: read');
assert.ok(!infraWf.permissions?.['id-token'], 'infra-validation.yml must NOT request id-token: write');
assert.ok(!/configure-aws-credentials|terraform apply|push:\s*true|staging-deploy\.yml/.test(infraWfRaw), 'infra-validation.yml must never configure AWS creds, apply Terraform, push images, or call staging-deploy.yml');

// 3. Validate docker-compose.staging.yml
const compose = YAML.parse(await readFile(path.join(ROOT, 'docker-compose.staging.yml'), 'utf8'));
assert.ok(compose.services?.['worker-1']?.environment?.WORKER_DATABASE_URL, 'worker-1 must receive WORKER_DATABASE_URL');
assert.ok(compose.services?.['worker-1']?.environment?.OPERZA_VAULT_KEY, 'worker-1 must receive OPERZA_VAULT_KEY');
assert.equal(compose.services?.api?.environment?.DISTRIBUTED_RATE_LIMIT_STRICT, 'true', 'api staging must enforce DISTRIBUTED_RATE_LIMIT_STRICT=true');

// 4. Machine-check .env.staging.example required keys & safe staging flags (never print values)
const envStagingRaw = await readFile(path.join(ROOT, '.env.staging.example'), 'utf8');
const envKeys = new Map();
for (const line of envStagingRaw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq > 0) envKeys.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
}
const requiredStagingKeys = [
  'NODE_ENV', 'DATABASE_URL', 'DATABASE_SSL', 'MIGRATION_DATABASE_URL',
  'WORKER_DATABASE_URL', 'REDIS_URL', 'ALLOW_IN_MEMORY_QUEUE',
  'SESSION_SECRET', 'OPERZA_VAULT_KEY', 'OPERZA_ADMIN_KEY', 'ALLOWED_ORIGINS'
];
for (const k of requiredStagingKeys) {
  assert.ok(envKeys.has(k) && envKeys.get(k).length > 0, `Missing required key in .env.staging.example: ${k}`);
}
assert.equal(envKeys.get('NODE_ENV'), 'staging', '.env.staging.example must set NODE_ENV=staging');
assert.equal(envKeys.get('ALLOW_IN_MEMORY_QUEUE'), 'false', '.env.staging.example must set ALLOW_IN_MEMORY_QUEUE=false');
assert.equal(envKeys.get('DATABASE_SSL'), 'true', '.env.staging.example must set DATABASE_SSL=true');

console.log(`✅ Validated ${tfFiles.length} Terraform files, ${wfFiles.length} GitHub workflows, docker-compose.staging.yml, and ${envKeys.size} .env.staging.example keys cleanly.`);
