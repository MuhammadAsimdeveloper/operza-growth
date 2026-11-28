# Regression CI Gates (Gate A & Gate G)

- **Gate A:** `npm audit --omit=dev --audit-level=high`, `npm run typecheck`, `@operza/action-governance`, `@operza/workflow-engine`, `packages/ui/test/ui.test.mjs`, `scripts/validate-staging-infra.mjs`.
- **Gate G (Sequential):** `@operza/platform-core`, `@operza/api`, `scripts/test-e2e.mjs`, `npm run build` (`@operza/web`), `npm --workspace=apps/marketing run build`, `scripts/seo-audit/run-seo-checks.mjs`.
