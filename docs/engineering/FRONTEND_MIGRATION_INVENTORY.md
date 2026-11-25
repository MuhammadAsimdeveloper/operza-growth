# Frontend Migration Inventory (Phase 2)

| Feature | Current data source | Target API | Migration status | Tests |
| --- | --- | --- | --- | --- |
| Auth & Session | `AuthContext.tsx` -> `/api/auth/*` | `/api/auth/login`, `/signup`, `/google`, `/magic-link`, `/verify-otp`, `/session`, `/me`, `/logout` | Hardening + Query cache clear | `apps/web/test/` |
| Agency, Locations & Team | `store.tsx` + `Settings.tsx`, `SubAccounts.tsx`, `Branding.tsx` | `/api/agency/profile`, `/api/agency/team*`, `/api/agency/locations*`, `/api/agency/branding*` | Migrating to TanStack Query | `apps/web/test/` |
| Contacts & Timeline | `store.tsx` (`seed.contacts`) | `/api/crm/contacts*`, `/api/crm/contacts/:id/timeline`, `/bulk-tag`, `/merge` | Migrating to TanStack Query | `apps/web/test/` |
| Opportunities & Pipelines | `store.tsx` (`seed.opportunities`, `seed.pipelines`) | `/api/crm/opportunities*`, `/api/crm/pipelines*` | Migrating to TanStack Query | `apps/web/test/` |
| Tasks | `store.tsx` (`seed.tasks`) | `/api/crm/tasks*` | Migrating to TanStack Query | `apps/web/test/` |
| Scheduling (Calendars & Appointments) | `store.tsx` (`seed.calendars`, `seed.appointments`) | `/api/crm/calendars*`, `/api/crm/appointments*`, `/api/calendars/public/*`, `/api/calendars/book/*` | Migrating to TanStack Query | `apps/web/test/` |
| Workflows & Executions | `store.tsx` (`seed.workflows`, `seed.workflowRuns`) | `/api/crm/workflows*`, `/api/workflows/:id/run`, `/api/workflows/runs*` | Migrating to TanStack Query | `apps/web/test/` |
| Funnels & Websites | `store.tsx` (`seed.sites`) | `/api/crm/funnels*`, `/api/crm/websites*`, `/api/websites/:id/publish` | Migrating to TanStack Query | `apps/web/test/` |
| Forms & Submissions | `store.tsx` (`seed.forms`) | `/api/crm/forms*`, `/api/forms/:id/publish`, `/api/forms/submissions`, `/api/forms/public/*`, `/api/forms/submit/*` | Migrating to TanStack Query | `apps/web/test/` |
| Conversations & Consents | `store.tsx` (`seed.conversations`) | `/api/crm/conversations*`, `/api/conversations/:id/messages`, `/api/platform/consents*` | Migrating to TanStack Query | `apps/web/test/` |
| Commerce (Orders, Payments, Invoices) | `store.tsx` (`seed.invoices`, `seed.orders`) | `/api/crm/orders*`, `/api/crm/invoices*`, `/api/crm/payments*`, `/api/ledger/*` | Migrating to TanStack Query | `apps/web/test/` |
| Reviews & Reputation | `store.tsx` (`seed.reviews`, `seed.reviewRequests`) | `/api/crm/reviews*`, `/api/reviews/:id/reply`, `/api/reviews/request*` | Migrating to TanStack Query | `apps/web/test/` |
| Dashboard & Reporting | `store.tsx` | `/api/dashboard/stats`, `/api/reporting/overview` | Migrating to TanStack Query | `apps/web/test/` |
