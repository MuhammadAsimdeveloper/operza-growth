# API Authorization Coverage — Stage 18

## 1. Consolidated Authorization Architecture

All modular routers now share `packages/platform-core/src/security/route-authz.mjs`:
- `checkActorPermission(actor, requiredPerm, alternativePerms)` — evaluates both API key scopes (`actor.apiKey` -> `actor.scopes`) and cookie-session RBAC roles (`actor.membership.role` -> `BUILTIN_ROLE_TEMPLATES` / custom roles) with legacy scope equivalence mapping. Fails closed (`false`) when `actor` is missing.
- `resolveActorPermissions(actor)` — resolves effective permission array without wildcard fallback.
- `canActorViewFinancials(actor)` — requires `billing:read`, `orders:read`, `payments:read`, `reports:financial:read`, or `agency:billing:manage`.
- `isPlatformAdminActor(actor)` — checks `actor?.isPlatformAdmin === true || actor?.user?.isPlatformAdmin === true`.

## 2. Domain Endpoint Inventory & Enforcement Summary

| Domain | Router(s) | Auth Required | Permission Enforcement | Agency Scope | Location Scope | Sensitive Data / Mutating | Audit Logged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Authentication** | `auth.mjs` | Public (`/login`, `/signup`, `/magic-link`, `/verify-otp`), Auth (`/session`, `/me`, `/logout`) | Rate-limited + CSRF on mutations | Resolved in DB tx | Filtered by `user_location_memberships` | Credentials / Session | Yes |
| **Agency Governance** | `agency.mjs`, `agency2.mjs` | Yes | `agency:*` + `requireAdminOrPerm` + `isAgencyAdmin` on `PUT /profile` | `TenantTx` (`app.agency_id`) | Location CRUD + assignment | Team / Invites / Roles / Sessions | Yes |
| **CRM & Customer 360** | `crm.mjs`, `crm2.mjs`, `contacts.mjs` | Yes | `contacts:read`, `contacts:create`, `contacts:write` | `TenantTx` + `FORCE RLS` | `location_id` scoped | PII / Merge / CSV Import | Yes |
| **Opportunities & Pipelines** | `opportunities.mjs`, `pipelines.mjs` | Yes | `opportunities:manage` / `pipelines:read|write` | `TenantTx` + `FORCE RLS` | `location_id` scoped | Deal values / Stage transitions | Yes |
| **Conversations & Support** | `conversations.mjs`, `support2.mjs` | Yes | `conversations:read|write`, `tickets:manage`, `sla:configure`, `canActorViewFinancials` | `TenantTx` + `FORCE RLS` | `location_id` scoped | Internal notes / Customer PII / Billing summary | Yes |
| **Engagement & Campaigns** | `engagement2.mjs`, `forms.mjs` | Yes (except `/api/forms/public|submit/*`) | `campaigns:read|write`, `consents:manage` | `TenantTx` + `FORCE RLS` | `location_id` scoped | Consent / Suppression / Campaigns | Yes |
| **Workflows & Ops** | `workflows.mjs`, `workflows2.mjs` | Yes (signed callbacks use token verification) | `workflows:read|write|trigger` via `checkActorPermission` | `TenantTx` + `FORCE RLS` | `location_id` scoped | Execution control / Retries / Cancel | Yes |
| **Integrations Hub** | `integrations2.mjs`, `zapier-router.mjs` | Yes (webhooks verify HMAC signatures) | `integrations:read|write` via `checkActorPermission` | `TenantTx` + `FORCE RLS` | `location_id` scoped | Vault secret refs / Webhooks | Yes |
| **AI Studio & Agents** | `ai.mjs`, `ai2.mjs` | Yes | `ai:read`, `ai:models:configure`, `ai:agents:manage` | `TenantTx` + `FORCE RLS` | `location_id` scoped | Agent memories / Usage | Yes |
| **Marketplace & Dev** | `marketplace2.mjs`, `phase7.mjs` | Yes (catalog read public/tenant) | `isPlatformAdminActor` for `/api/platform-admin/*`; owner check for `/api/developer/*` | `TenantTx` / Owner-scoped | Agency/Platform | App approval / Scopes | Yes |
| **Analytics & BI** | `analytics2.mjs` | Yes | `reports:read` + `resolveActorPermissions(actor)` | `TenantTx` + `FORCE RLS` | `location_id` scoped | Financial & CRM aggregates | Yes |
| **Commerce & Billing** | `payments.mjs`, `commerce2.mjs` | Yes (webhooks verify signature) | `orders:read`, `billing:read`, `invoices:write`, `refunds:approve`, `agency:billing:manage` | `TenantTx` + `FORCE RLS` | `location_id` scoped | Payments / Refunds / Ledger | Yes |
| **Websites & Funnels** | `funnels.mjs`, `sites2.mjs`, `domains.mjs` | Yes | `funnels:read|write`, `websites:read|write` | `TenantTx` + `FORCE RLS` | `location_id` scoped | Page publish / Custom domains | Yes |
| **Customer Portal** | `portal2.mjs` | Yes | `agency:settings:read|write`, `tickets:manage`, `conversations:read|write` | `TenantTx` + `FORCE RLS` | `location_id` scoped | Portal config / Customer requests | Yes |
| **Scheduling & Reviews & Tasks** | `scheduling.mjs`, `reviews.mjs`, `tasks.mjs` | Yes (public booking routes scoped by slug) | `scheduling:*`, `reviews:*`, `tasks:*` | `TenantTx` + `FORCE RLS` | `location_id` scoped | Appointments / Tasks | Yes |
| **Platform Admin & System** | `system.mjs` | `/health`, `/ready` public; `/metrics` redacts tenant counts unless admin; `/api/admin/*` requires `OPERZA_ADMIN_KEY` or `isPlatformAdmin` | Platform Admin only | Global / Operator | N/A | Queue / Outbox / Telemetry | Yes |

## 3. Built-in Role Permission Matrix (Verified by `stage-18-hardening.test.mjs`)

All 12 built-in roles (`owner`, `admin`, `operations_manager`, `location_manager`, `sales_manager`, `sales_agent`, `support_manager`, `support_agent`, `marketing_manager`, `marketing_specialist`, `analyst`, `read_only`) are enforced consistently for cookie-session users via `checkActorPermission`.
