-- Migration 021: Add external_event_id to appointments
-- Supports idempotent calendar sync across API restarts and multi-process deployments

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS external_event_id text;

CREATE INDEX IF NOT EXISTS appointments_external_event_id_idx
  ON appointments (agency_id, calendar_id, external_event_id)
  WHERE external_event_id IS NOT NULL;
