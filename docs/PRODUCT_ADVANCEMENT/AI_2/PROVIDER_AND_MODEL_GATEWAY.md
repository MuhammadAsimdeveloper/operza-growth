# Provider & Model Gateway 2.0

**Module:** `packages/platform-core/src/ai/model-router-v2.mjs` (extending `provider-gateway.mjs`)

## 1. Readiness Levels
Models expose honest readiness: `configured`, `connection_tested`, `capability_verified`, `operationally_verified`, and `unavailable`.

## 2. Budget-Safe Capability Routing
`routeModel` filters by `authorizedModels`, `minContextWindow`, and `requiredCapabilities` (`toolCalling`, `structuredOutput`, `streaming`, `embeddings`). When the preferred model is unavailable or budget is exhausted, it falls back only to compatible non-paid models unless `allowPaidFallback` and `remainingBudgetMicrocents > 0` are both satisfied, reporting `degraded: true` and the actual model selected.
