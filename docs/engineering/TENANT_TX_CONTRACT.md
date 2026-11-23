# Operza Growth — TenantTx Database Contract Specification

## 1. Specification Overview

The `TenantTx` boundary is the core security and multi-tenancy abstraction in the Operza platform. It provides an isolated, scoped transactional execution environment for all database operations, ensuring that PostgreSQL Row Level Security (RLS) is reliably configured for every query without leaking session state across pooled connections.

---

## 2. Interface Definition & Signatures

```typescript
export interface TenantContext {
  agencyId: string;    // UUID v4 of the tenant agency
  locationId: string;  // UUID v4 of the active tenant location
  actorId: string;     // UUID v4 of the initiating user / system actor
}

export interface ITenantTx {
  readonly client: pg.PoolClient;
  readonly context: TenantContext;
  readonly agencyId: string;
  readonly locationId: string;
  readonly actorId: string;

  /**
   * Executes a parameterized SQL query bound to the active tenant transaction client.
   */
  query<R = any>(text: string, params?: any[]): Promise<pg.QueryResult<R>>;
}

export type TenantWorkCallback<T> = (tx: ITenantTx) => Promise<T>;

/**
 * Runs a transactional block of work under an authenticated, verified tenant context.
 */
export function runInTenantTx<T>(
  pool: pg.Pool,
  context: TenantContext,
  work: TenantWorkCallback<T>
): Promise<T>;
```

---

## 3. Strict Pre-Conditions & Invariants

1. **Mandatory Context Validation**:
   - `context.agencyId` must be a valid, non-empty UUID string.
   - `context.locationId` must be a valid, non-empty UUID string.
   - `context.actorId` (or `context.userId`) must be a valid, non-empty UUID string.
   - Violation throws `TENANT_CONTEXT_REQUIRED` with HTTP `400 / 401` mapping.
2. **Atomic Context Initialization**:
   - The transaction MUST issue `BEGIN` before applying any configuration parameters.
   - Context settings MUST use `is_local = true`:
     ```sql
     SELECT set_config('app.agency_id', $1, true),
            set_config('app.location_id', $2, true),
            set_config('app.user_id', $3, true);
     ```
   - This guarantees that parameters automatically revert upon `COMMIT` or `ROLLBACK`.
3. **Dedicated Client Leases**:
   - All queries within `work(tx)` MUST execute on the leased `client` provided by `tx`.
   - Repositories MUST NEVER invoke global `pool.query()` while executing inside a `TenantTx`.
4. **Guaranteed Release Lifecycle**:
   - The leased `client` MUST be released back to `pg.Pool` inside a `finally` block under all execution outcomes (successful commit, expected business exception, or unexpected database crash).
5. **No Context Switching**:
   - Once a `TenantTx` is instantiated, the tenant context cannot be reassigned or mutated. Any attempt to modify `tx.agencyId` or `tx.locationId` is blocked.

---

## 4. Execution State Machine

```
              [ Client Leased from Pool ]
                          |
                          v
                    [ Issue BEGIN ]
                          |
                          v
       [ Issue set_config('app.*', ..., true) ]
                          |
                          v
                [ Execute work(tx) ]
                   /              \
         (Success)                 (Exception)
            /                           \
           v                             v
    [ Issue COMMIT ]              [ Issue ROLLBACK ]
           \                             /
            \                           /
             v                         v
           [ Release Client to pg.Pool ]
                          |
                          v
          [ Return Result / Re-throw Error ]
```

6. **Error Isolation & Rollback Guarantees**:
   - If an error occurs inside `work(tx)`, `ROLLBACK` is issued before releasing the client.
   - If `ROLLBACK` fails, the original error is preserved and re-thrown without being masked by the secondary rollback failure.
   - Context objects are frozen; properties cannot be mutated post-initialization.

---

## 5. Security & Isolation Guarantees

1. **Row Level Security Compliance**:
   - The database role executing these queries (`operza_app`) has `FORCE ROW LEVEL SECURITY` applied across all tenant tables.
   - Because `operza_app` does NOT possess `BYPASSRLS`, queries cannot select or mutate rows outside the tenant specified in `app.agency_id` and `app.location_id`.
2. **Defense-in-Depth Parameterization**:
   - Domain repositories built on `TenantTx` also include `agency_id = $1 AND location_id = $2` in their SQL queries as a defense-in-depth measure alongside PostgreSQL RLS.
3. **No Connection Poisoning**:
   - Using transaction-local settings (`set_config(..., true)`) ensures that even if a pooled connection is checked out later for a different tenant, previous session variables do not persist.
