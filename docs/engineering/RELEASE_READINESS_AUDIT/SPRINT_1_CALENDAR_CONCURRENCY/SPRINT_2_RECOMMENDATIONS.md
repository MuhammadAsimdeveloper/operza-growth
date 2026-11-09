# Sprint 2 Engineering Recommendations & Implementation Roadmap

**Document ID:** `ROADMAP-SPRINT-2-RECOMMENDATIONS`  
**Subsystem:** Workflow Engine, Queue Reliability & Relational Normalization  
**Author:** Principal Software Architect & Release Auditor  
**Date:** November 9, 2026  
**Status:** Ready for Planning  

---

## 1. Context & Retrospective from Sprints 0 & 1

With the successful completion of **Sprint 0** (P0 Authentication, Session Security & Tenant Scoping) and **Sprint 1** (PostgreSQL GiST Exclusion Constraints & Multi-Process Appointment Booking Concurrency), Operza has resolved its two most critical security and data-integrity vulnerabilities.

During Sprint 1, architectural investigation revealed several downstream subsystems that warrant targeted hardening in **Sprint 2** prior to private beta launch.

---

## 2. Priority Focus Areas for Sprint 2

### 2.1 P1: Relational Schema Formalization for Contacts
- **Current Observation:** Contacts are primarily stored in `state.records.contacts` and mapped into `location_records` in PostgreSQL. While `appointments.contact_id` stores a valid UUID, there is currently no standalone `contacts` relational table in PostgreSQL migrations, causing `syncRelationalWrite` to emit sync notices.
- **Sprint 2 Objective:** 
  1. Author migration `016_contacts_relational_table.sql` defining:
     ```sql
     CREATE TABLE IF NOT EXISTS contacts (
       id uuid NOT NULL,
       agency_id uuid NOT NULL,
       location_id uuid NOT NULL,
       first_name text NOT NULL DEFAULT '',
       last_name text NOT NULL DEFAULT '',
       email text,
       phone text,
       company text,
       status text NOT NULL DEFAULT 'lead',
       tags jsonb NOT NULL DEFAULT '[]'::jsonb,
       custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (agency_id, location_id, id),
       FOREIGN KEY (agency_id, location_id) REFERENCES locations(agency_id, id) ON DELETE CASCADE
     );
     ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
     ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
     CREATE POLICY contacts_tenant_scope ON contacts ...
     ```
  2. Implement bidirectional synchronization between memory state and the new relational table.

### 2.2 P1: Workflow Engine Durability & Multi-Worker Lease Safety
- **Current State:** `@operza/workflow-engine` has unit tests for worker leases (`claimExecutionLease`, `heartbeatExecutionLease`, `recoverAbandonedExecutions`).
- **Sprint 2 Objective:**
  1. Implement a live multi-worker integration test harness simulating abrupt worker termination (`SIGKILL`) during active execution.
  2. Verify that abandoned execution leases are reliably reclaimed by standby workers without duplicate side effects (idempotency key enforcement on outbound HTTP/Email actions).
  3. Verify that workflows paused in `waiting_webhook` or `pending_approval` states persist cleanly through API restarts and resume immediately upon arrival of the resume webhook.

### 2.3 P2: Public Booking Anti-Abuse & Bot Protection
- **Current State:** Rate limiting exists per IP window, but public booking endpoints (`POST /api/calendars/book/:idOrSlug`) lack bot challenge mechanisms.
- **Sprint 2 Objective:**
  1. Add optional Cloudflare Turnstile / Google reCAPTCHA v3 verification middleware for public calendar booking routes.
  2. Implement sliding-window rate limiting per email and phone number to prevent calendar denial-of-service (slot exhaustion).

### 2.4 P2: Timezone Normalization & DST Boundary Handling
- **Current State:** Appointments store ISO 8601 UTC strings (`starts_at`, `ends_at`) and calendars define an agency timezone.
- **Sprint 2 Objective:**
  1. Implement explicit timezone conversion test suite covering Daylight Saving Time (DST) transition weekends across US, EU, and Australian timezones.
  2. Verify that recurring availability schedules (`09:00 - 17:00`) generate correct UTC slot ranges during the DST spring-forward and fall-back boundaries.

---

## 3. Sprint 2 Implementation Roadmap & Milestones

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             SPRINT 2 ROADMAP                                │
├──────────────────────────┬──────────────────────────────────────────────────┤
│ Stage                    │ Deliverables                                     │
├──────────────────────────┼──────────────────────────────────────────────────┤
│ 1. Contacts Schema       │ Migration 016 (contacts DDL + RLS policies)       │
│                          │ apps/api/server.mjs contact relational sync       │
│                          │ Verification suite: contacts-rls-isolation.test  │
├──────────────────────────┼──────────────────────────────────────────────────┤
│ 2. Workflow Leases       │ Multi-worker crash recovery integration test     │
│                          │ Outbound action idempotency lock enforcement     │
│                          │ Webhook resumption durability verification       │
├──────────────────────────┼──────────────────────────────────────────────────┤
│ 3. Ingress Anti-Abuse    │ Bot protection middleware (Turnstile / Captcha)  │
│                          │ Contact email/phone sliding-window rate limit    │
├──────────────────────────┼──────────────────────────────────────────────────┤
│ 4. Timezone & DST        │ Multi-timezone DST boundary test suite           │
│                          │ Recurrence interval availability generator       │
└──────────────────────────┴──────────────────────────────────────────────────┘
```

---

## 4. Quality Gates & Acceptance Criteria for Sprint 2

1. **Zero Sync Notices:** PostgreSQL synchronization for contacts, calendars, and appointments operates with zero errors or schema warnings.
2. **Worker Crash Invariant:** When a worker running a multi-node workflow is terminated mid-execution, a peer worker claims the task within `LEASE_TIMEOUT_MS`, detects the already-completed steps via action receipts, and resumes from the exact failure point without duplicating external actions.
3. **Continuous Data Protection:** `apps/api/data/store.json` remains strictly untouched by test suites.
