-- Migration 054: Ensure operza_app_state is provisioned by operza_migrator
-- so least-privilege operza_app never attempts DDL at API startup in staging/production.
CREATE TABLE IF NOT EXISTS operza_app_state (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE operza_app_state TO operza_app;
