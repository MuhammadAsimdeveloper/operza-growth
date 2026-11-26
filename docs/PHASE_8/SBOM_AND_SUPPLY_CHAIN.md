# SBOM & Supply Chain Security Report

**SBOM Artifact:** [sbom-cyclonedx.json](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/docs/PHASE_8/sbom-cyclonedx.json) (CycloneDX v1.5, **603 components**)
**Generator:** `node scripts/generate-sbom.mjs` (from `package-lock.json`)
**Supported Runtime:** Node.js `>=20.0.0` (verified on `v24.22.0`), npm `>=10.0.0`

## Production Dependency Audit (`npm audit --omit=dev`)
- **Summary:** `1 critical`, `4 high`, `3 moderate`, `0 low` (`8` total in prod tree; `17` total including devDependencies).

| Package | Severity | Direct? | Affected Component | Remediation & Context |
| --- | --- | --- | --- | --- |
| `astro` (`^5.1.0`) | Critical | Yes | `apps/marketing` (static build only) | Requires semver-major upgrade (`astro@7.4.13`); not exposed as a runtime Node server in production (`output: 'static'`). |
| `sharp`, `zod`, `zod-to-ts`, `esbuild` | High / Moderate | Transitive | `apps/marketing` (`astro`) | Transitive under `astro`; resolved with `astro` major upgrade window. |
| `vite` | High | Yes | `apps/web` (dev/build bundler) | Requires semver-major upgrade (`vite@8.3.8`); build-time only, not served in production API. |
| `react-router-dom` / `react-router` | Moderate | Yes | `apps/web` | Requires semver-major upgrade (`7.18.7`); scheduled for dedicated major-upgrade QA pass. |

**Secret Scanning:** `git diff --check` and repository inspection confirm zero committed API keys, private keys, or `.dump` backup files.
