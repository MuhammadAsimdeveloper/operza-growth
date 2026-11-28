# Frontend Accessibility and UX Quality — Stage 18

## 1. Error Boundaries & Failure Experience

- `apps/web/src/components/AppShell.tsx` wraps all application routes in `RouteErrorBoundary` (`lines 1279-1351`) so a failed screen does not crash the entire shell.
- `apps/web/src/components/BiStudio2Panel.tsx` distinguishes `authoritative: false` local development data from PostgreSQL-backed data with a `role="status"` warning banner and semantic badge.

## 2. TypeScript, Build & Responsive Verification

- `npm --workspace=@operza/web run typecheck` passes with `0` errors.
- `npm --workspace=@operza/web run build` and `npm --workspace=apps/marketing run build` succeed cleanly.
- Playwright browser verification across desktop, laptop, tablet, and mobile viewports confirms `0` uncaught page errors and `0` horizontal overflow.
