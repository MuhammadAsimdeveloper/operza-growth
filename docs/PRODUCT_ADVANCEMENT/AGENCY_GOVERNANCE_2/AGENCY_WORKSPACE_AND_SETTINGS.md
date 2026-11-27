# Agency Workspace & Settings

- `agencies` (`001_agency_tenant_core.sql`, extended in `052_agency_governance_2_0.sql`) persists `name`, `slug` (validated & unique), `email`, `phone`, `website`, `category`, `logo_url`, `address`, `country`, `default_language`, `default_timezone`, `default_currency`, `regional_preferences`, and `onboarding_state`.
- `GET / PUT /api/agency/v2/workspace` enforces `agency:settings:write` and returns `409 DUPLICATE_WORKSPACE_SLUG` on slug collision.
