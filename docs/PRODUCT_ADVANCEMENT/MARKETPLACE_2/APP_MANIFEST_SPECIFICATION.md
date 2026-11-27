# Application Manifest Specification

**Module:** `packages/platform-core/src/marketplace-2-0.mjs`

## 1. Required & Validated Fields
- `slug`: 3–61 lowercase alphanumeric/hyphen characters.
- `name`: 2–100 characters.
- `appType`: One of `native_integration`, `external_connector`, `workflow_extension`, `ai_agent_extension`, `ai_tool`, `reporting_extension`, `business_template`, `workflow_template`, `automation_package`.
- `version`: Semantic version (`MAJOR.MINOR.PATCH[-prerelease]`).
- `requestedScopes`: Subset of `ALLOWED_SCOPES` (`contacts:read`, `contacts:write`, `opportunities:read`, `opportunities:write`, `workflows:trigger`, `workflows:execute`, `reports:read`, `communications:send`, `tasks:write`, `knowledge:read`).
- `pricingModel`: `free`, `one_time`, `subscription`, `usage_based`, or `freemium` with integer `priceCents >= 0`.
- `documentationUrl` / `privacyPolicyUrl` / `termsOfServiceUrl` / `supportUrl`: HTTPS-only.
- **Security:** Rejects payloads `> 100 KB` or containing `eval(`, `new Function`, `<script`, `__proto__`, or `constructor(`.
