import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

console.log('=====================================================');
console.log('🚀 Starting Operza Unified Business OS & Automation');
console.log('=====================================================');

const api = spawn('node', ['apps/api/server.mjs'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    PORT: '4000',
    NODE_ENV: 'development'
  }
});

const web = spawn('npm', ['run', 'dev'], {
  cwd: path.join(root, 'apps/web'),
  stdio: 'inherit',
  shell: true
});

const shutdown = () => {
  console.log('\nShutting down Operza services...');
  api.kill();
  web.kill();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
