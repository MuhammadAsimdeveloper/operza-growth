-- The registry contains only opaque public slugs and tenant record identifiers.
-- It lets public form requests resolve a tenant without granting broad record access.
CREATE TABLE IF NOT EXISTS public_form_registry (
  slug text PRIMARY KEY CHECK (slug ~ '^[A-Za-z0-9_-]{32,64}$'),
  agency_id uuid NOT NULL,
  location_id uuid NOT NULL,
  form_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id,location_id) REFERENCES locations(agency_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS public_form_registry_tenant_idx
  ON public_form_registry(agency_id,location_id,form_id);
