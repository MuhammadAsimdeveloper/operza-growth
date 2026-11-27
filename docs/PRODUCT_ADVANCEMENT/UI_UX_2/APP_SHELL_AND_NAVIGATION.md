# App Shell & Navigation 2.0

**Modules:** `apps/web/src/components/AppShell.tsx`, `CommandPalette.tsx`, `AuthContext.tsx`

## 1. Navigation Structure
- **Pinned Primary:** Dashboard (`/`), Command Center (`/command-center`), Conversations (`/conversations`), Notification Center (`/notifications`), App Directory (`/apps`).
- **Pillar Groups:** CRM & Pipelines, Marketing & Sites, Automation & AI, Commerce & Billing, Administration.
- **Command Palette (`Ctrl+K` / `Cmd+K`):** Keyboard-navigable quick jump and safe action launcher.
- **Tenant Cache Isolation:** `AuthContext.logout()` and `AuthContext.switchLocation()` invoke `clearTenantCache()` (`queryClient.clear()`) and `purgePwaTenantCaches()` to prevent stale cross-tenant data.
