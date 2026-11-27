# Customer Portal 2.0 — UX Verification

- **Agency Admin Workspace (`ClientPortal.tsx` + `PortalHub2Panel.tsx`):** Provides portal configuration (branding, support email, welcome message, enable/disable), self-service request approval queue (`requested` -> `approved` / `rejected`), security summary, and live customer portal navigation preview.
- **Separation from Internal Admin UI:** Customer-facing portal navigation (`Home`, `Appointments`, `Messages`, `Orders`, `Invoices`, `Documents`, `Profile`, `Preferences`) is kept distinct from internal Operza agency administration.
- **Scope Note:** Interactive browser verification of the Stage 12 `PortalHub2Panel` rests on TypeScript compilation, Vite bundling, and `116/116` E2E system verification; dedicated customer-login Playwright scenarios remain for staging QA.
