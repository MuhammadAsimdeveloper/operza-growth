-- Phase 1.9: Forms, Form Submissions, Tasks, Reviews & Review Requests
-- Enforces composite tenant PKs, FORCE ROW LEVEL SECURITY, valid status/rating
-- constraints, and least-privilege grants for operza_app and operza_worker.

CREATE TABLE IF NOT EXISTS forms (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  public_slug text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published boolean NOT NULL DEFAULT false,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  completion jsonb NOT NULL DEFAULT '{}'::jsonb,
  submissions_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS forms_location_created_idx
  ON forms (agency_id, location_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS forms_public_slug_idx
  ON forms (public_slug)
  WHERE public_slug IS NOT NULL;

ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS forms_tenant_scope ON forms;
CREATE POLICY forms_tenant_scope ON forms
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

CREATE TABLE IF NOT EXISTS form_submissions (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL,
  contact_id uuid,
  idempotency_key text,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id, form_id) REFERENCES forms(agency_id, location_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS form_submissions_form_idx
  ON form_submissions (agency_id, location_id, form_id, submitted_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS form_submissions_idempotency_idx
  ON form_submissions (agency_id, location_id, form_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS form_submissions_tenant_scope ON form_submissions;
CREATE POLICY form_submissions_tenant_scope ON form_submissions
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

CREATE TABLE IF NOT EXISTS tasks (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  notes text,
  contact_id uuid,
  opportunity_id uuid,
  assigned_to text,
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  due_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS tasks_location_status_idx
  ON tasks (agency_id, location_id, status, due_date ASC);
CREATE INDEX IF NOT EXISTS tasks_contact_idx
  ON tasks (agency_id, location_id, contact_id)
  WHERE contact_id IS NOT NULL;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tasks_tenant_scope ON tasks;
CREATE POLICY tasks_tenant_scope ON tasks
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

CREATE TABLE IF NOT EXISTS reviews (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  contact_id uuid,
  contact_name text NOT NULL DEFAULT 'Verified Client',
  email text,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'Direct Client Portal',
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'published', 'hidden', 'flagged', 'archived')),
  reply text,
  replied_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS reviews_location_received_idx
  ON reviews (agency_id, location_id, received_at DESC);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reviews_tenant_scope ON reviews;
CREATE POLICY reviews_tenant_scope ON reviews
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

CREATE TABLE IF NOT EXISTS review_requests (
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email', 'sms', 'whatsapp')),
  message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'sent', 'failed', 'cancelled')),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, location_id, id),
  FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
);

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_requests_tenant_scope ON review_requests;
CREATE POLICY review_requests_tenant_scope ON review_requests
  USING (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  )
  WITH CHECK (
    agency_id = nullif(current_setting('app.agency_id', true), '')::uuid
    AND location_id = nullif(current_setting('app.location_id', true), '')::uuid
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON forms, form_submissions, tasks, reviews, review_requests TO operza_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_worker') THEN
    GRANT SELECT, INSERT, UPDATE ON forms, form_submissions, tasks, reviews, review_requests TO operza_worker;
  END IF;
END $$;
