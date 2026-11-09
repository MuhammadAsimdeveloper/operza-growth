# PostgreSQL GiST Exclusion Constraints for Appointment Concurrency

**Document ID:** `DB-GUIDE-EXCLUSION-CONSTRAINT`  
**Subsystem:** PostgreSQL Database & Storage Engine  
**Author:** Principal Database Reliability Engineer  
**Status:** Canonical Reference  
**Date:** November 9, 2026  

---

## 1. Introduction to Exclusion Constraints

In standard relational databases, uniqueness is enforced using `UNIQUE` constraints backed by B-Trees. However, a `UNIQUE` constraint can only enforce scalar equality ($a = b$). It cannot enforce overlap conditions over intervals, where conflict occurs if two time spans intersect:
$$[start_1, end_1) \cap [start_2, end_2) \neq \emptyset$$

PostgreSQL solves this with **Exclusion Constraints** (`EXCLUDE USING gist`), which generalize uniqueness to arbitrary operators. An exclusion constraint guarantees that if any two rows are compared on the specified columns using the specified operators, at least one of these operator comparisons will evaluate to false.

---

## 2. The `btree_gist` Extension Requirement

By default, PostgreSQL's Generalized Search Tree (`GiST`) index only supports geometric and range types with operators like `&&` (overlaps), `@>` (contains), and `<@` (is contained by). It does *not* support standard equality (`=`) on scalar types such as `uuid`, `text`, or `integer`.

To allow an exclusion constraint to predicate on both scalar tenant/resource IDs and time ranges simultaneously:
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```
The `btree_gist` extension provides GiST operator classes for standard PostgreSQL data types, enabling equality (`WITH =`) alongside interval overlap (`WITH &&`) in a single unified index.

---

## 3. Migration DDL: `015_appointment_concurrency_exclusion.sql`

The complete DDL implemented in Sprint 1 is structured into five distinct safety phases:

### Phase 1: Extension Verification
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

### Phase 2: Time-Range Invariant Check
Before enforcing interval mutual exclusion, the database must guarantee that every appointment has valid chronological bounds:
```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_appointments_time_range'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT chk_appointments_time_range
      CHECK (ends_at > starts_at);
  END IF;
END $$;
```
This constraint prevents zero-duration or negative-duration appointments ($ends\_at \le starts\_at$).

### Phase 3: Non-Destructive Conflict Pre-Check
If an existing production database already contains overlapping appointments, applying an exclusion constraint would fail hard or risk data corruption. Migration 015 runs a non-destructive audit before altering the table:
```sql
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
```
If historical conflicts exist, the migration halts with an informative error, preserving data integrity until an administrator reconciles the historical records.

### Phase 4: GiST Exclusion Constraint Application
```sql
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
```

### Phase 5: Public Lookup RLS Policy for Active Calendars
Because `calendars` table has `FORCE ROW LEVEL SECURITY`, public booking ingress requires a read policy to resolve public calendars by slug without requiring tenant administrative privileges:
```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'calendars' AND policyname = 'calendars_public_lookup'
  ) THEN
    CREATE POLICY calendars_public_lookup ON calendars
      FOR SELECT
      USING (status = 'active');
  END IF;
END $$;
```

---

## 4. PostgreSQL Error Handling: `23P01` vs `23505`

When a concurrent conflict occurs, PostgreSQL raises an exception with a specific ANSI/ISO SQLSTATE code:

| Error Code | Error Constant | Cause in PostgreSQL | Application Handling |
|---|---|---|---|
| **`23P01`** | `exclusion_violation` | A row violates an `EXCLUDE` constraint (e.g. overlapping appointment). | Catch, rollback transaction, return HTTP `409 Conflict` with `SLOT_CONFLICT`. |
| **`23505`** | `unique_violation` | A row violates a standard `UNIQUE` or primary key constraint. | Catch, return HTTP `409 Conflict` with resource duplication code. |

In `apps/api/server.mjs`:
```javascript
catch (dbErr) {
  await client.query('ROLLBACK').catch(() => {});
  if (dbErr.code === '23P01' || dbErr.message?.includes('exclude_overlapping_active_appointments')) {
    return sendJson(res, 409, {
      error: 'This time slot is no longer available. Please choose another time.',
      code: 'SLOT_CONFLICT'
    });
  }
  throw dbErr;
}
```

---

## 5. Performance and Indexing Characteristics

### 5.1 GiST Tree Traversal
GiST indexes build a balanced search tree over bounding ranges. For range queries and overlap checks:
- Search complexity is $O(\log N)$ on average.
- Insert complexity is $O(\log N)$ with index node splitting when required.

### 5.2 Concurrency and Locking
PostgreSQL acquires a lightweight lock on the GiST index page during insertion. If two transactions attempt to insert into the same tree page concurrently:
1. Transaction 1 acquires index page lock and writes the index entry.
2. Transaction 2 blocks until Transaction 1 commits or rolls back.
3. Once Transaction 1 commits, Transaction 2 re-evaluates the exclusion condition, detects the committed conflicting range, and raises `23P01`.
4. Transaction 2 rolls back cleanly.

No long-lived table-level locks (`SHARE`, `EXCLUSIVE`) are held, ensuring high transaction throughput for unrelated calendars or time slots.

---

## 6. Tenancy & Isolation Verification

The exclusion constraint is strictly multi-tenant:
1. **Identical Times, Different Calendars:**
   ```sql
   calendar_id WITH =
   ```
   If two appointments share the exact same start and end time, but belong to different calendars within the same location, the equality comparison on `calendar_id` evaluates to `false`. Therefore, the exclusion constraint is NOT violated. Both succeed.
2. **Identical Times, Different Agencies:**
   ```sql
   agency_id WITH =
   ```
   If two appointments share the exact same start and end time, but belong to different agencies, the equality comparison on `agency_id` evaluates to `false`. Both succeed.
3. **Identical Calendar, Overlapping Time:**
   `agency_id`, `location_id`, and `calendar_id` all match (`true`), and `tstzrange && tstzrange` is `true`. All conditions evaluate to `true`. Constraint is violated. The second insert fails.

This mathematical design ensures 100% tenant isolation with zero possibility of cross-tenant booking collisions.
