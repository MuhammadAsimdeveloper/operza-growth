-- ==============================================================================
-- Migration: 015_appointment_concurrency_exclusion.sql
-- Subsystem: Calendar & Appointment Concurrency Isolation
-- Scope: Multi-tenant, resource-scoped, half-open interval GiST exclusion
-- ==============================================================================

-- 1. Ensure required btree_gist extension is available for scalar equality operators
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Validate time-range integrity: ends_at must be strictly greater than starts_at
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_appointments_time_range'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT chk_appointments_time_range
      CHECK (ends_at > starts_at);
  END IF;
END $$;

-- 3. Non-destructive conflict pre-check: verify no existing active appointment records overlap
DO $$
DECLARE
  conflict_count integer;
BEGIN
  SELECT count(*)/2 INTO conflict_count
  FROM appointments a1
  JOIN appointments a2 ON
    a1.agency_id = a2.agency_id
    AND a1.location_id = a2.location_id
    AND a1.calendar_id = a2.calendar_id
    AND a1.id != a2.id
    AND a1.status != 'cancelled'
    AND a2.status != 'cancelled'
    AND tstzrange(a1.starts_at, a1.ends_at, '[)') && tstzrange(a2.starts_at, a2.ends_at, '[)');

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION_BLOCKED: Detected % pre-existing overlapping active appointment pair(s) in appointments table. Refusing destructive migration.', conflict_count;
  END IF;
END $$;

-- 4. Apply authoritative GiST exclusion constraint on active appointments
-- Interval semantics: '[)' half-open range allows adjacent appointments where end == next start.
-- Partial predicate: excludes 'cancelled' records, instantly releasing cancelled slots.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exclude_overlapping_active_appointments'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT exclude_overlapping_active_appointments
      EXCLUDE USING gist (
        agency_id WITH =,
        location_id WITH =,
        calendar_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      )
      WHERE (status != 'cancelled');
  END IF;
END $$;

-- 5. Public read policy for active calendars by slug / id for unauthenticated booking ingress
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'calendars' AND policyname = 'calendars_public_lookup'
  ) THEN
    CREATE POLICY calendars_public_lookup ON calendars
      FOR SELECT
      USING (status = 'active');
  END IF;
END $$;
