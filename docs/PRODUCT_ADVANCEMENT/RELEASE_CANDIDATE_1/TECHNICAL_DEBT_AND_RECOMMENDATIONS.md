# Technical Debt & Recommendations

1. **Coexisting v1 & v2 API Prefixes:** Legacy v1 endpoints (`/api/crm/*`, `/api/payments/*`, `/api/workflows/*`) coexist with v2 endpoints (`/api/<module>/v2/*`). Recommend publishing a formal OpenAPI 3.1 spec and deprecating redundant v1 endpoints post-RC1.
2. **Dev-Only Dependency Advisories (`npm audit`):** 10 dev-only advisories (`zod <4.6.6`, `eslint`, `@typescript-eslint/*`, `minimatch`). Production dependencies (`--omit=dev`) have **0** advisories. Schedule a non-breaking devDependencies update PR after RC1.
3. **Environment Variable Naming Consistency:** Both `PG_POOL_MAX` and `PG_MAX_POOL` appear in DB config; both `MIGRATION_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, and `ADMIN_DATABASE_URL` exist. Consolidate onto single canonical names in staging IaC.
4. **3 Unimplemented Catalog Connectors:** `shopify`, `meta_ads`, and `slack` currently fail closed with `501 INTEGRATION_ADAPTER_NOT_IMPLEMENTED`. Implement or hide from public marketplace catalog before pilot if not in scope.
5. **Automated Accessibility Gate:** Add `axe-core` Playwright assertions and physical mobile PWA install verification to staging QA.
