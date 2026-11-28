# Dependency and Supply-Chain Audit — Stage 18

## 1. Observed `npm audit` Outcomes

- **Production Dependencies (`npm audit --omit=dev --json`):**
  - `critical: 0`, `high: 0`, `moderate: 0`, `low: 0`, `info: 0`, **`total: 0`**
- **Full Workspace Audit (`npm audit --json`, including `devDependencies`):**
  - `critical: 0`, `high: 1` (`zod` transitive dev dependency), `moderate: 9` (`eslint`, `@eslint/config-array`, `minimatch`, `@typescript-eslint/*` transitive dev dependencies), `low: 0`, **`total: 10`**.
  - None of the 10 dev-only findings are present in production runtime dependencies (`--omit=dev`).

## 2. Upgrade & SBOM Posture

- Major-version upgrades to `eslint` / `typescript-eslint` were intentionally deferred in Stage 18 to avoid uncontrolled breaking changes to lint/build tooling.
- `package-lock.json` is committed and consistent across all workspaces (`apps/*`, `packages/*`).
- No dedicated CycloneDX/SPDX SBOM generator is currently installed in `package.json`; `package-lock.json` serves as the deterministic dependency manifest until CI SBOM generation (`@cyclonedx/cyclonedx-npm` or `syft`) is added.
