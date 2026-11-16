-- Migration 019: Worker Heartbeats and Cluster Observability
-- Tracks active worker processes for health probes and cluster telemetry

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id text PRIMARY KEY,
  hostname text,
  pid integer,
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'alive' CHECK (status IN ('alive', 'stopped', 'degraded')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS worker_heartbeats_alive_idx
  ON worker_heartbeats (status, last_heartbeat_at DESC);

-- Allow worker role to report heartbeats
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON worker_heartbeats TO operza_worker;
  END IF;
END $$;
