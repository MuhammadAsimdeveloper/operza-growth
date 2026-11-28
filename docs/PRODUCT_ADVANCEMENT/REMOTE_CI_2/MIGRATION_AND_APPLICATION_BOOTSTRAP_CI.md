# Migration & Application Bootstrap CI (Gates E & F)

- Runs `node packages/db/scripts/migrate.mjs` (`001`–`054` as `operza_migrator`).
- Verifies `apps/api/server.mjs` (`operza_app`, `NODE_ENV=staging`) boots cleanly without runtime DDL and serves `/health` and `/ready`.
- Verifies `apps/api/worker.mjs` (`operza_worker`) starts cleanly and terminates on `SIGTERM`.
