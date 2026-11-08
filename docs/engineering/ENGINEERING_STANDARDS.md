# Operza Engineering Standards & Code Quality Guide

This document defines the technical standards, programming idioms, and quality guidelines enforced across all packages in the Operza monorepo.

---

## 1. Monorepo & Module Boundaries

### Monorepo Topology
- Operza uses native npm workspaces (`apps/*`, `packages/*`).
- Applications (`apps/web`, `apps/api`) consume shared packages (`packages/*`) via workspace dependencies.
- Packages must **never** import from applications.
- Circular dependencies between packages are strictly prohibited.

### Deep Modules
- Every package must expose a minimal, stable public API through its entry point (`index.ts` / `index.mjs`).
- Internal logic, helpers, and utilities must live in private subdirectories (e.g., `src/internal/` or `lib/`) and must not be imported directly by external consumers.
- If a package requires more than 5 distinct external dependencies to perform its core duty, review its scope with the Principal Architect.

---

## 2. TypeScript & Modern JavaScript (ESM)

1. **Native ES Modules:**
   - All code is written as modern ECMAScript Modules (`"type": "module"`).
   - Use standard `import` / `export` syntax. CommonJS `require()` is prohibited unless interfacing with legacy third-party libraries.
2. **Strict Typing:**
   - Avoid `any`. Use `unknown` for unvalidated external input and narrow via Zod schemas or type guards.
   - Prefer interfaces for public contract definitions and type aliases for unions, primitives, and mapped types.
   - Use discriminating unions for state machines, action payloads, and execution results.
3. **Immutability & Pure Functions:**
   - Prefer immutable transformations (`map`, `filter`, object spread) over in-place mutations.
   - Functions should be focused, single-purpose, and pure where practical.
   - Keep side effects (I/O, database writes, external network requests) at system boundaries.

---

## 3. Backend & API Engineering (Fastify / Node.js)

1. **Typed Contracts & Validation:**
   - Every HTTP endpoint must validate query parameters, URL parameters, and request bodies using Zod schemas.
   - Validation failures must return `400 Bad Request` with structured error details identifying invalid fields.
2. **Consistent Status Codes:**
   - `200 OK`: Successful read or idempotent update.
   - `201 Created`: Successful resource creation (include `Location` header or resource ID).
   - `204 No Content`: Successful deletion or action with no response body.
   - `400 Bad Request`: Schema validation failure or malformed payload.
   - `401 Unauthorized`: Missing or invalid authentication token.
   - `403 Forbidden`: Authenticated user lacks permission or tenant context.
   - `404 Not Found`: Resource does not exist within the tenant.
   - `409 Conflict`: Unique constraint violation or state transition conflict.
   - `422 Unprocessable Entity`: Syntactically valid input violates domain invariants.
   - `500 Internal Server Error`: Unhandled server exception (scrubbed of internal stack traces).
3. **Structured Errors & Fail Loudly:**
   - Define custom domain errors inheriting from a base `AppError`.
   - Never swallow exceptions with empty `catch` blocks.
   - Log errors with contextual metadata (`requestId`, `tenantId`, `locationId`, `userId`, `errorName`).

---

## 4. Frontend Engineering (React 19 & Vite)

1. **Component Composition over Boolean Props:**
   - Avoid components with dozens of boolean flags (`isCompact`, `hasBorder`, `showIcon`, `isModal`, `withHeader`).
   - Use compound component patterns (`Card`, `Card.Header`, `Card.Body`, `Card.Footer`) or clean slot composition.
2. **Eliminate Network Waterfalls:**
   - Never chain sequential `useEffect` data-fetching calls.
   - Fetch independent data in parallel.
   - Use Suspense boundaries to stream slow UI sections without blocking fast interactive elements.
3. **Clean State Management:**
   - Distinguish server state (remote CRM data, API caches) from local ephemeral UI state (dropdown open, active tab).
   - Do not duplicate server data in local component state. Derive values synchronously during render.
4. **Vite Optimization & Bundle Discipline:**
   - Avoid monolithic barrel files (`index.ts` re-exporting hundreds of components) in frontend apps.
   - Use dynamic imports (`React.lazy()`) for heavy route modules and modal dialogs.

---

## 5. Security & Sensitive Paths

- **Tenant Scoping:** Every database query touching tenant data must bind to the tenant context.
- **Input Sanitization:** Sanitize all rich text and user-generated HTML to prevent Cross-Site Scripting (XSS).
- **Audit Logging:** Record operational audit logs for all security-critical actions (role changes, credential rotation, bulk exports, account deletions).
- **Environment Variables:** Access secrets exclusively via centralized configuration modules; never reference `process.env` directly in domain logic.

---

## 6. Prohibited Anti-Patterns

- **No Monolithic Files:** Break files exceeding 400 lines into cohesive, modular subcomponents.
- **No Mock-Heavy Testing:** Avoid mocking entire database layers or complex internal services; test against hermetic PGlite databases or real contracts.
- **No Suppressed Warnings:** Fix compiler warnings, TypeScript errors, and linter warnings at the source.
- **No Phantom Features:** Never leave placeholder UI buttons or simulated stub responses without explicit labeling and human approval.
