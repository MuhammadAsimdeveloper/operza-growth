import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const migrationUrl=process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL;
if (!migrationUrl) {
  console.error('Set MIGRATION_DATABASE_URL (or DATABASE_URL) to a PostgreSQL migration-owner connection.');
  process.exitCode = 1;
} else {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const directory = path.join(root,'migrations');
  const pool = new Pool({connectionString:migrationUrl,max:1,connectionTimeoutMillis:5000,ssl:process.env.PGSSL==='true'?{rejectUnauthorized:true}:undefined});
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    if ((await pool.query("SELECT 1 FROM pg_roles WHERE rolname='operza_app'")).rowCount) await pool.query('REVOKE ALL ON TABLE schema_migrations FROM operza_app');
    const names=(await readdir(directory)).filter(name=>/^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
    for(const name of names){
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)',[741029181]);
        const applied=await client.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name]);
        if(applied.rowCount){await client.query('COMMIT');continue;}
        await client.query(await readFile(path.join(directory,name),'utf8'));
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)',[name]);
        await client.query('COMMIT');
        console.log(`Applied ${name}`);
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
    }
  }catch(error){console.error('Migration failed:',error.message);process.exitCode=1;}finally{await pool.end();}
}

