# Operza Phase 12: Agency Multi-Tenancy & Platform Foundation

## 1. Executive Summary

Phase 12 guarantees bulletproof multi-tenant isolation, hierarchical agency governance, and automated client provisioning. Operza is architected from the database schema up as an **agency-first operating system**, allowing agencies to manage unlimited client sub-accounts with complete data segregation.

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                           OPERZA MULTI-TENANT TOPOLOGY                            │
└───────────────────────────────────────────────────────────────────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
         Agency Tenant A                                 Agency Tenant B
      (agency_id: 818d6037...)                        (agency_id: c3462712...)
                 │                                               │
        ┌────────┴────────┐                             ┌────────┴────────┐
        ▼                 ▼                             ▼                 ▼
   Location 1        Location 2                    Location 1        Location 2
  (sub-account)     (sub-account)                 (sub-account)     (sub-account)
        │                 │                             │                 │
 ─── PostgreSQL Row-Level Security (RLS) & Client Sanitization Gate ───────────────
        ▼                 ▼                             ▼                 ▼
   Contacts          Workflows                     Contacts          Workflows
   Pipelines         Telephony                     Pipelines         Telephony
```

---

## 2. Agency Hierarchy & Sub-Account Management

### 2.1 Sub-Accounts & Location Isolation
- **Endpoints:** `POST /api/agency/locations`, `GET /api/agency/locations`
- **Isolation Scope:** Every contact, pipeline, deal, workflow, conversation, phone number, and form is strictly bound to `(agencyId, locationId)`.
- **Client Sanitization:** Client-supplied `agencyId` or `locationId` headers in write requests are immediately discarded; the server extracts authorized tenant scopes strictly from the verified session context.

### 2.2 Account Snapshots (1-Click Blueprint Cloning)
- **Endpoints:** `POST /api/agency/snapshots`, `POST /api/agency/snapshots/:id/deploy`
- **Mechanism:** Agencies snapshot their best-performing business setups (workflows, pipelines, calendars, forms, payment links, and trigger links) and deploy them into new client workspaces in one click.

### 2.3 Role-Based Access Control (RBAC) & Team Invitations
- **Roles:** `owner` | `admin` | `member` | `viewer`
- **Governance:** Non-admin team members cannot modify billing plans, access KMS secret vaults, or authorize Copilot write proposals.
- **Invitations:** Secure token-based invitation lifecycle (`/api/agency/team/invite`) with role assignment and audit trail logging.

---

## 3. Database Architecture & PostgreSQL RLS Migrations

Operza maintains 10 formal database migrations in `packages/db/migrations/`:

| Migration File | Architectural Capability |
| :--- | :--- |
| `001_agency_tenant_core.sql` | Agency, membership, location tables, and PostgreSQL Row-Level Security policies. |
| `002_public_form_registry.sql` | Public forms, submissions registry, custom field mapping. |
| `003_workflow_executions.sql` | Workflow definitions, execution timeline tables, and state persistence. |
| `004_workflow_templates.sql` | Pre-packaged industry automation templates and blueprint schemas. |
| `005_agency_snapshots.sql` | Agency snapshot repository, blueprint metadata, and deployment logs. |
| `006_ecosystem_and_telephony.sql`| Phone numbers, call records, IVR routes, and developer API keys. |
| `007_workflow_step_simulation_status.sql`| Simulation mode statuses, dry-run flags, and side-effect barriers. |
| `008_platform_foundation.sql` | Transactional outbox table (`operza_outbox`), dead-letter queue, and lease tracking. |
| `009_copilot_proposals.sql` | AI write proposals, four-eyes review records, and action receipts. |
| `010_zapier_and_agent_suite.sql`| Zapier REST hooks, HMAC secrets, and multi-agent memory session store. |

---

## 4. Dual Persistence Engines: PostgreSQL & Zero-Config Mode

- **Production Mode:** Connects to PostgreSQL using `pg.Pool`, enforcing RLS (`CREATE POLICY tenant_isolation_policy ON ... USING (agency_id = current_setting('app.current_agency_id'))`).
- **Zero-Config Development Mode:** Connects to high-performance atomic file persistence (`data/store.json`). Guarantees immediate out-of-the-box development without requiring a local database daemon.

---

## 5. Verification Evidence

- `@operza/db` Migrations & Repository Unit Tests: 9 / 9 passing
- End-to-End System Tests:
  - `[TEST 14] Agency Sub-Accounts: Provisioning & Isolation` (PASSED)
  - `[TEST 15] Agency Snapshots: Blueprint Creation & Deployment` (PASSED)
  - `[TEST 53] Agency Team Access Governance & Invitation Lifecycle` (PASSED)
  - `[TEST 73] Cross-Tenant Injection Immunity: Client-supplied IDs sanitized` (PASSED)
