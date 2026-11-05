# Operza Quality Gates & Verification Standards

All code contributions must satisfy these strict quality gates prior to release:

## 1. Type Safety & Compilation Gate
- `npm run typecheck` (`tsc -b --noEmit`) must exit with code 0 and zero TypeScript diagnostic errors.
- No `any` type escapes on security-critical boundaries (auth, payment webhooks, database RLS contexts).

## 2. Test Gate
- `npm test` must run and pass all test suites:
  1. Workflow Engine Unit & Graph Traversal (14 tests)
  2. SEO, Sitemap, OpenGraph & Metadata Audits (20 tests)
  3. Auth & Database Integration (16 tests)
  4. Tenant Forms & Migration Integrity (49 tests)
  5. Security, Payments & Ingress Verification (21 tests)
  6. Full-Stack E2E Multi-Tenant Journeys (90 tests)
  7. Enterprise AI Copilot & RAG Guardrails (24 tests)
- Total passing tests: 234 automated checks, 0 failures.

## 3. Production Build & Bundle Gate
- `npm run build` must compile cleanly with Vite 5.
- Zero CSS syntax or unrecognized property warnings.

## 4. Security Gate
- Zero unresolved P0 vulnerabilities.
- Cryptographic signature validation on all external webhooks in production.
- CSRF validation active on all state-mutating HTTP methods.
- Outbound URL allowlisting / SSRF defense on all workflow HTTP/webhook nodes.
