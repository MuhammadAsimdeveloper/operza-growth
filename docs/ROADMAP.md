# Operza Platform Rebuild & Security Roadmap

## Milestone 1: Security, Webhook & Payment State Integrity (COMPLETED)
- [x] Comprehensive brutal audit, risk register, and reality matrix generated.
- [x] Elimination of fake paid orders: Checkout creates pending orders; paid status granted only upon cryptographically verified webhook event.
- [x] Removal of Meta webhook backdoor challenge (`meta_chall_44`) and verification token enforcement.
- [x] CSRF token lifecycle: `csrfToken` returned in `/api/auth/session`, `/api/auth/login`, `/api/auth/signup`, and dedicated `/api/auth/csrf`.
- [x] Web API client automatic CSRF caching and token injection.
- [x] CSS property camelCase warning fixed in production build.
- [x] 21 automated regression tests created and passing.

## Milestone 2: Server Modularization & Real Provider Adapters (IN PROGRESS)
- [ ] Split monolithic `server.mjs` (8,800+ lines) into modular controllers under `apps/api/src/`.
- [ ] Connect CRM entities to direct PostgreSQL client with RLS session variables (`withTenantTransaction`).
- [ ] Distributed Redis rate limiting with proxy trust validation.

## Milestone 3: Figma-Led Atlas Desktop Control Center UI (SCHEDULED)
- [ ] Complete UI overhaul aligning with Figma reference `Atlas-Desktop-Control-Center` (Node `1:60`).
- [ ] Upgraded Signature Workflow Canvas with pan/zoom gestures, bezier connectors, and step inspector.
- [ ] Enhanced CRM and commerce dashboard tables with tabular typography.

## Milestone 4: Verification, Colab Benchmarks & Staging Acceptance (SCHEDULED)
- [ ] Execute Colab benchmark and evaluation notebooks.
- [ ] Full end-to-end multi-tenant isolation verification.
- [ ] Production build and staging deployment sign-off.
