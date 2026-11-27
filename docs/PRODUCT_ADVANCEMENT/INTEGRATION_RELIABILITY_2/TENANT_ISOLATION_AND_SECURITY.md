# Tenant Isolation & Security — Stage 16

- Cross-tenant IDOR & join isolation verified under real PostgreSQL (`operza_app` role with `FORCE ROW LEVEL SECURITY`) in `cross-platform-reliability-2-0.test.mjs`: Tenant B cannot query Tenant A's Customer 360, Support Inbox, Tickets, or Workflow Executions.
- Portal cross-agency magic link (`MAGIC_LINK_AGENCY_MISMATCH`) and cross-customer ownership (`CUSTOMER_OWNERSHIP_DENIED`) verified.
- Secret keys (`apiKey`, `secret`, `token`, `password`) are redacted in all cross-module event envelopes and AI contexts.
