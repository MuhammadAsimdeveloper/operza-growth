# Appointment Concurrency & Isolation Architecture Design

**Document ID:** `ARCH-DES-SPRINT-1-CONCURRENCY`  
**System:** Operza Scheduling & Calendar Engine  
**Author:** Principal Software Architect & Database Reliability Engineer  
**Status:** Approved & Implemented  
**Date:** November 9, 2026  

---

## 1. Architectural Overview

Appointment booking is a mission-critical transactional operation in Operza. The system must uphold a strict invariant:
> **For any bookable calendar resource, two overlapping active appointments must NEVER be confirmed concurrently—regardless of whether incoming requests arrive simultaneously at the same API process or across distinct distributed API instances.**

This document details the architectural evolution from the legacy in-memory model to the authoritative PostgreSQL GiST exclusion engine.

---

## 2. Model Comparison: In-Memory vs. Database-Enforced

| Dimension | Legacy In-Memory Model | Authoritative Database Model (Sprint 1) |
|---|---|---|
| **Authority** | In-memory JavaScript array (`state.records.appointments`) | Relational PostgreSQL table `appointments` |
| **Concurrency Scope** | Single Node.js event loop only | Global across all processes, clusters, and workers |
| **Race Condition Defense** | None (async gaps between read and write) | Atomic PostgreSQL GiST exclusion lock |
| **Multi-Process Safety** | ❌ Fails (Processes maintain separate memories) | ✅ 100% Guaranteed by storage engine |
| **Boundary Handling** | Custom string splitting (`T10:00:`) | Native mathematical interval algebra (`tstzrange`) |
| **Adjacent Appointments** | Manual edge-case checks | Native `[)` half-open boundary semantics |
| **Cancellation Slot Release** | Manual array filtering | Partial index predicate (`WHERE status != 'cancelled'`) |
| **Rollback & Durability** | Uncontrolled process state mutation | Full ACID transaction isolation (`BEGIN...COMMIT`) |

---

## 3. Failure Mode Analysis (Legacy Architecture)

### 3.1 Single-Process Asynchronous Window Race
In Node.js, event-loop concurrency permits interleaved execution of asynchronous operations:

```
Client 1                        Server Event Loop                       Client 2
   │                                    │                                  │
   │─── POST /book (10:00) ────────────>│                                  │
   │                                    │<─── POST /book (10:00) ──────────│
   │                                    │                                  │
   │                          [Check 1: Slot Free?]                        │
   │                          [Result: TRUE]                               │
   │                                    │                                  │
   │                                    │─── [Check 2: Slot Free?]         │
   │                                    │─── [Result: TRUE]                │
   │                                    │                                  │
   │                          [Insert 1: Confirm]                          │
   │<─── HTTP 201 Confirmed ────────────│                                  │
   │                                    │─── [Insert 2: Confirm]           │
   │                                    │─── HTTP 201 Confirmed ──────────>│
```
Because the asynchronous read occurred for both requests prior to either write completing, both clients received confirmation for the identical slot.

### 3.2 Distributed Multi-Process Split-Brain
In production, Operza runs across multiple Node.js processes behind a load balancer (e.g. Caddy, NGINX, or Kubernetes Ingress):

```
Client 1 (Alpha)               Process 1 (Port 4301)     Process 2 (Port 4302)             Client 2 (Beta)
   │                                    │                         │                               │
   │─── POST /book (10:00) ────────────>│                         │                               │
   │                                    │                         │<─── POST /book (10:00) ───────│
   │                          [Check Proc 1 Memory]     [Check Proc 2 Memory]                     │
   │                          [Slot 10:00 is Free]      [Slot 10:00 is Free]                      │
   │                          [Push to Proc 1 Memory]   [Push to Proc 2 Memory]                   │
   │<─── HTTP 201 Confirmed ────────────│                         │                               │
   │                                    │                         │─── HTTP 201 Confirmed ───────>│
```
Without a centralized, atomic lock at the storage level, each process makes decisions based on localized state, resulting in catastrophic double-booking.

---

## 4. Authoritative PostgreSQL Coordination Engine

In Sprint 1, mutual exclusion is offloaded to the database engine.

### 4.1 Sequence Diagram: Atomic Concurrency Resolution

```
Client A (Proc 1)       Process 1               PostgreSQL 18            Process 2        Client B (Proc 2)
   │                       │                          │                      │                     │
   │── POST /book (10:00) ─>│                          │                      │                     │
   │                       │── BEGIN ────────────────>│                      │                     │
   │                       │                          │<── BEGIN ────────────│<── POST /book (10:00)
   │                       │── INSERT appt [10-10:30)>│                      │                     │
   │                       │   (Locks GiST tree node) │                      │                     │
   │                       │                          │<── INSERT appt [10-10:30)                  │
   │                       │                          │    (Blocks waiting on lock)                │
   │                       │── COMMIT ───────────────>│                      │                     │
   │                       │                          │── Constraint Violation!                    │
   │                       │                          │   (SQLSTATE 23P01)──>│                     │
   │                       │                          │<── ROLLBACK ─────────│                     │
   │<── HTTP 201 Created ──│                          │                      │── HTTP 409 Conflict>│
```

---

## 5. Mathematical Interval Semantics: The Choice of Half-Open `[)` Ranges

A central design choice is the range representation: `tstzrange(starts_at, ends_at, '[)')`.

### 5.1 Interval Syntax Definition
- `[`: Inclusive lower bound (start time is part of the appointment).
- `)`: Exclusive upper bound (end time is NOT part of the appointment).

### 5.2 Why Closed Intervals `[]` Fail for Calendars
If closed intervals `[]` were used:
- Appointment 1: `[09:00, 09:30]`
- Appointment 2: `[09:30, 10:00]`
Under closed interval rules, the timestamp `09:30:00.000` belongs to *both* intervals:
$$\{t \mid 09:00 \le t \le 09:30\} \cap \{t \mid 09:30 \le t \le 10:00\} = \{09:30\}$$
Because the intersection is non-empty ($\{09:30\}$), PostgreSQL would reject Appointment 2 as an overlap conflict! This would make back-to-back bookings impossible.

### 5.3 Half-Open `[)` Correctness
Under half-open interval rules:
- Appointment 1: $[09:00, 09:30) = \{t \mid 09:00 \le t < 09:30\}$
- Appointment 2: $[09:30, 10:00) = \{t \mid 09:30 \le t < 10:00\}$
The intersection is empty:
$$[09:00, 09:30) \cap [09:30, 10:00) = \emptyset$$
Adjacent back-to-back appointments succeed cleanly, while any true overlap (e.g. $[09:15, 09:45)$) produces:
$$[09:00, 09:30) \cap [09:15, 09:45) = [09:15, 09:30) \neq \emptyset$$
which is immediately rejected.

---

## 6. HTTP Interface & Error Sanitization

### 6.1 Public Ingress: `POST /api/calendars/book/:idOrSlug`

#### Success Response (`HTTP 201 Created`):
```json
{
  "success": true,
  "appointment": {
    "id": "e2a4b86e-821f-4cf2-8328-98e3bbdce91e",
    "agencyId": "1b089c89-2911-4775-a0bc-98129df83570",
    "locationId": "2c943188-75f8-417c-a496-c189b41dc082",
    "calendarId": "f9042b08-6158-4061-9c12-32a76f2f0b90",
    "contactId": "c4d1568e-1738-4e55-bd3a-e9a993701ea5",
    "title": "Strategy Call with Jane Doe",
    "startsAt": "2026-11-10T10:00:00.000Z",
    "endsAt": "2026-11-10T10:30:00.000Z",
    "status": "confirmed"
  }
}
```

#### Conflict Response (`HTTP 409 Conflict`):
When a race condition or existing appointment is detected:
```json
{
  "error": "This time slot is no longer available. Please choose another time.",
  "code": "SLOT_CONFLICT"
}
```
**Security Note:** Database error details (e.g., PostgreSQL error code `23P01`, constraint name `exclude_overlapping_active_appointments`, table name `appointments`) are stripped before sending the response to the caller.

---

## 7. Lifecycle: Cancellation and Rescheduling

### 7.1 Instant Slot Release via Partial Index
Because the constraint includes `WHERE (status != 'cancelled')`, updating an appointment status to `'cancelled'` immediately removes it from the GiST index.
The slot becomes instantaneously available for new bookings without requiring vacuuming or table rewrites.

### 7.2 Atomic Rescheduling (`PUT /api/crm/appointments/:id`)
When an appointment is rescheduled to a new time slot:
1. The update transaction runs:
   ```sql
   UPDATE appointments
   SET starts_at = $1, ends_at = $2, updated_at = now()
   WHERE id = $3 AND agency_id = $4 AND location_id = $5;
   ```
2. The GiST index checks whether the new range overlaps with any other active appointment in the same calendar.
3. If an overlap is detected, the transaction aborts with `23P01`, and the API returns:
   ```json
   {
     "error": "Cannot reschedule: the selected time slot conflicts with an existing appointment.",
     "code": "SLOT_CONFLICT"
   }
   ```
4. If free, the update commits and the in-memory cache is updated.

---

## 8. Summary of Guarantees

1. **Zero Double Bookings:** Enforced by PostgreSQL storage engine.
2. **Zero In-Memory Drift:** In-memory state is only mutated after the relational transaction commits.
3. **Multi-Tenant Isolation:** Enforced via `agency_id`, `location_id`, and `app.agency_id` RLS context.
4. **Resiliency:** Clean rollback on conflict leaves zero phantom rows.
