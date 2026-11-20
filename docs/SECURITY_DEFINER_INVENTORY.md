# SECURITY DEFINER Function Inventory & Privilege Matrix

## Overview

In PostgreSQL, functions marked `SECURITY DEFINER` execute with the privileges of the role that owns the function rather than the role invoking it. To preserve strict multi-tenant Row-Level Security (RLS) and adhere to least-privilege principles, the Operza platform isolates all `SECURITY DEFINER` functions under a dedicated, unprivileged owner role: `operza_auth_definer`.

---

## 1. Dedicated Definer Role: `operza_auth_definer`

The `operza_auth_definer` role is strictly governed:
- **`NOLOGIN`**: Cannot be used for direct network connections or application pools.
- **`NOSUPERUSER`**: Has no administrative or cluster-level privileges.
- **`NOCREATEDB` & `NOCREATEROLE`**: Cannot provision databases or roles.
- **`NOINHERIT`**: Cannot inadvertently pass privileges to members through default inheritance.
- **`BYPASSRLS`**: Permitted to bypass RLS policies strictly within the vetted, parameter-checked logic of its owned functions.
- **Schema & Table Grants**: Only granted `USAGE, CREATE` on schema `public`, `SELECT` on `users`, `agencies`, `locations`, `auth_sessions`, `calendars`, and `SELECT, UPDATE` on `workflow_approvals`, `workflow_executions`, `workflow_execution_steps`. Cannot modify audit logs, ledgers, or provider secrets.

---

## 2. Function Inventory

| Function Name | Signature | Owner | Execution Grants | Revoked From | RLS Bypass Rationale | Tables Read / Modified | Tenant Validation Mechanism | Callers |
|---|---|---|---|---|---|---|---|---|
| `resolve_auth_session` | `resolve_auth_session(p_token_hash text)` | `operza_auth_definer` | `operza_app` | `PUBLIC`, `operza_worker` | Resolves tenant session for unauthenticated HTTP requests presenting a session cookie before tenant context is set | Read: `auth_sessions`, `users`, `agencies`<br>Write: None | High-entropy SHA-256 token match; checks active expiration and user/agency status | `apps/api/server.mjs` (session resolution middleware) |
| `lookup_user_for_auth` | `lookup_user_for_auth(p_email text)` | `operza_auth_definer` | `operza_app` | `PUBLIC`, `operza_worker` | Queries user credentials during login before tenant session context exists | Read: `users`<br>Write: None | Sanitized/normalized email match; returns status to fail closed on inactive accounts | `apps/api/routes/auth.mjs` (login endpoint) |
| `lookup_public_calendar` | `lookup_public_calendar(p_slug text)` | `operza_auth_definer` | `operza_app` | `PUBLIC`, `operza_worker` | Allows prospective customers on public booking pages to resolve calendar info by URL slug | Read: `calendars`<br>Write: None | Exact unique slug match; returns `agency_id` & `location_id` for subsequent scoped actions | `apps/api/server.mjs` (`GET /api/public/calendar/:slug`) |
| `expire_pending_workflow_approvals` | `expire_pending_workflow_approvals()` | `operza_auth_definer` | `operza_worker` | `PUBLIC`, `operza_app` *(Revoked in Phase 20.2)* | Global background maintenance across all tenants; transitions expired approvals and halts waiting workflows | Read: `workflow_approvals`<br>Write: `workflow_approvals`, `workflow_executions`, `workflow_execution_steps` | Batch maintenance isolated strictly to background worker; composite key `(agency_id, location_id)` updates | `apps/api/worker.mjs` (background maintenance loop) |
| `expire_tenant_workflow_approvals` | `expire_tenant_workflow_approvals(p_agency_id uuid, p_location_id uuid)` | `operza_auth_definer` | `operza_app`, `operza_worker` | `PUBLIC` | Tenant-scoped expiration of expired approvals during user interaction | Read: `workflow_approvals`<br>Write: `workflow_approvals`, `workflow_executions`, `workflow_execution_steps` | **MANDATORY (Migration 027)**: Validates non-null `p_agency_id` and `p_location_id` arguments. Mandates non-null and non-empty `app.agency_id` and `app.location_id` session settings. Enforces NULL-safe strict equality via `IS DISTINCT FROM` against validated session UUIDs. Fails closed on malformed UUID strings. Completely prevents cross-location approval expiration within the same agency. | `apps/api/server.mjs` (`GET /api/workflows/approvals`, `GET /api/workflows/runs`, `POST /api/workflows/runs/:id/approve\|reject`) |

---

## 3. Security Boundaries & Invariants

1. **Explicit Search Path**: Every `SECURITY DEFINER` function explicitly specifies `SET search_path = public` to defeat search path hijacking.
2. **Revocation from PUBLIC**: PostgreSQL grants execute on new functions to `PUBLIC` by default. Every migration defining a security-definer function explicitly executes `REVOKE ALL ON FUNCTION ... FROM PUBLIC;`.
3. **Privilege Separation**:
   - `operza_app` is forbidden from invoking global cross-tenant `expire_pending_workflow_approvals()`.
   - `operza_worker` is forbidden from invoking user authentication lookup (`lookup_user_for_auth`) and session resolution (`resolve_auth_session`).
   - `operza_migrator` (unprivileged `NOSUPERUSER, NOBYPASSRLS`) runs DDL migrations and sets role to `operza_auth_definer` to define and own functions via its membership in `operza_auth_definer`.
4. **Mandatory Location Context**: Following Migration 027, `expire_tenant_workflow_approvals` strictly enforces location context. Empty or null location settings are rejected, preventing cross-location expiration within the same tenant agency.
