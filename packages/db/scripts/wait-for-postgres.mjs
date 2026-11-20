import pg from 'pg';

const connectionString = 
  process.env.MIGRATION_DATABASE_URL || 
  process.env.DATABASE_URL || 
  process.env.OPERZA_TEST_DATABASE_URL || 
  process.argv[2] || 
  'postgresql://operza_ci_admin:ci_test_password_123@127.0.0.1:5432/operza_ci_test';

const sanitizedUrl = connectionString.replace(/:[^:@]+@/, ':***@');
console.log(`[PG-WAIT] Probing PostgreSQL readiness at: ${sanitizedUrl}`);

const MAX_ATTEMPTS = 30;
const RETRY_INTERVAL_MS = 1000;
let connected = false;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 2000,
    max: 1
  });

  try {
    const res = await pool.query('SELECT 1 AS ready');
    if (res.rows && res.rows[0]?.ready === 1) {
      console.log(`✓ PostgreSQL service is ready and accepting queries (attempt ${attempt}/${MAX_ATTEMPTS}).`);
      connected = true;
      await pool.end();
      break;
    }
  } catch (err) {
    await pool.end().catch(() => {});
    const msg = err.code ? `${err.code} - ${err.message}` : err.message;
    console.log(`[PG-WAIT] Attempt ${attempt}/${MAX_ATTEMPTS}: waiting for database (${msg})...`);
    if (attempt < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
    }
  }
}

if (!connected) {
  console.error(`✗ [PG-WAIT] Timed out waiting for PostgreSQL after ${MAX_ATTEMPTS} attempts (${(MAX_ATTEMPTS * RETRY_INTERVAL_MS) / 1000}s).`);
  process.exit(1);
}
