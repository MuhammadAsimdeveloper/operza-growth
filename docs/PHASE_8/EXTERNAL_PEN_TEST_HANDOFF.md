# External Penetration Test Scope & Handoff

**Status:** **NOT YET EXECUTED** — Must be completed by a qualified independent third-party assessor against an isolated staging environment prior to unrestricted general availability.

## In-Scope Targets
1. Public API & Auth (`/api/auth/*`, `/api/oauth/*`, `/api/v1/zapier/*`, `/api/gdpr/*`).
2. Multi-tenant PostgreSQL `FORCE RLS` boundaries across Agencies and Locations.
3. Custom domain host routing, SSR HTML renderer, and ACME/edge TLS termination.
4. AI RAG prompt-injection boundaries and Tool Registry V2 approval gates.
5. PWA Service Worker cache isolation and session revocation.

## Exclusions
- Do not target live third-party provider APIs (Stripe, Twilio, SendGrid, Gemini/OpenAI).
