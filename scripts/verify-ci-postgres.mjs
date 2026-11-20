import { spawn } from 'node:child_process';
import { IsolatedTestPostgres } from '../packages/db/lib/test-postgres-server.mjs';

console.log('=====================================================');
console.log('🚀 Phase 20.2.5 Real PostgreSQL CI Verification Script');
console.log('=====================================================');

const server = new IsolatedTestPostgres({ port: 5439, dbName: 'operza_ci_local_test' });
const dbUrl = await server.start();
console.log(`[CI-RUNNER] Isolated PostgreSQL started at: ${dbUrl}`);

process.env.OPERZA_TEST_DATABASE_URL = dbUrl;
process.env.MIGRATION_DATABASE_URL = dbUrl;
process.env.REQUIRE_POSTGRES_INTEGRATION = 'true';

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n[EXEC] ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, ...env }
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command ${cmd} ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

try {
  // Step 1: Run migration runner
  console.log('\n--- STEP 1: Running Migration Runner (001-027) ---');
  await run('node', ['packages/db/scripts/migrate.mjs']);

  // Step 2: Run @operza/db tests with real PostgreSQL
  console.log('\n--- STEP 2: Running @operza/db Test Suite ---');
  await run('npm', ['--workspace=@operza/db', 'test']);

  // Step 3: Run Workflow Persistence & API DB Integration Tests
  console.log('\n--- STEP 3: Running Workflow Persistence & API Integration Tests ---');
  await run('node', [
    '--test',
    'apps/api/test/workflow-persistence-reliability.test.mjs',
    'apps/api/test/durable-workflow-and-postgres.test.mjs',
    'apps/api/test/auth-postgresql-authority.test.mjs',
    'apps/api/test/appointment-concurrency-api.test.mjs'
  ]);

  console.log('\n🎉 ALL REAL POSTGRESQL INTEGRATION TESTS PASSED CLEANLY! 🎉');
} finally {
  console.log('\n[CI-RUNNER] Stopping PostgreSQL server...');
  await server.stop();
  console.log('[CI-RUNNER] PostgreSQL server stopped.');
}
