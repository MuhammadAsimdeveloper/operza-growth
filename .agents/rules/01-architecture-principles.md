# Rule 01: Architecture Principles and Code Quality

## 1. Architecture Before Implementation
- **Never make broad architectural modifications without upfront planning.**
- Every non-trivial change requires:
  1. Understanding the existing implementation and callers.
  2. Mapping out module dependencies and affected seams.
  3. Reviewing existing alternatives in both Operza and Atlas.
  4. Defining the target contract/interface (TypeScript types and schemas).
  5. Writing an explicit implementation plan with acceptance criteria.
  6. Defining test fixtures and regression scenarios.
- Prefer incremental migration and clean module boundaries over high-risk, wholesale rewrites.

## 2. Target Modular Architecture
Operza converges towards a clean monorepo topology:
```text
operza-growth/
├── apps/
│   ├── web/                     # React 19 / Vite UI application
│   ├── api/                     # Fastify/Express Node.js HTTP API
│   └── worker/                  # Background worker & durable queue runner
├── packages/
│   ├── shared/                  # Shared types, validation, and utilities
│   ├── db/                      # PostgreSQL client, schema, RLS, and migrations
│   ├── customer-domain/         # Core CRM, contacts, leads, bookings, accounts
│   ├── workflow-engine/         # Graph validation, state machine, and node registry
│   ├── action-governance/       # Action registry, permissions, approvals, policies
│   ├── integrations/            # Verified provider adapters (Stripe, Twilio, GHL, etc.)
│   ├── ai-runtime/              # Copilot engine, agent runtime, skills, LLM gateways
│   ├── customer-operations/     # Unified inbox, messaging, email, multichannel
│   └── observability/           # Logging, tracing, audit ledger, and metrics
└── docs/engineering/            # Canonical architecture, ADRs, and runbooks
```
*Note: Do not create empty scaffold packages arbitrarily. Existing packages (`packages/platform-core`, `packages/workflow-engine`, `packages/db`, `packages/shared`) remain active until planned refactoring cleanly transitions them.*

## 3. Deep Modules and Clean Seams
- Modules must be **deep**: substantial capabilities hidden behind small, stable, cohesive interfaces.
- Avoid "shallow" modules where the interface is as complex as the implementation.
- Hide implementation details in internal subdirectories; expose only explicit public exports via entrypoints (`index.ts` / `index.mjs`).

## 4. Code Quality Standards and Anti-Patterns
Strictly prohibit:
- Monolithic files with mixed, unrelated responsibilities.
- Duplicate business logic across packages or between apps.
- Circular dependencies between modules.
- Unbounded functions, deeply nested callbacks, and unhandled async promises.
- Fake or stubbed implementations presented as functioning features.
- Unused dependencies or arbitrary framework abstractions.
- Dead code, orphaned feature flags, and commented-out code blocks.
- Suppressed errors (`catch (e) {}` with no logging or recovery).
- Hardcoded configuration values, secrets, or environment-specific URLs.
- Excessive mock-based tests that test implementation details rather than contracts.

All code must feature:
- Explicit type contracts (TypeScript / Zod schemas).
- Structured domain error classes with machine-readable error codes.
- Explicit dependency injection for testability and portability.
- Immutable data transformations over unexpected in-place state mutations.
