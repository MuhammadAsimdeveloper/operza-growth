# Mobile & PWA 2.0 — Accessibility Review

- **Landmarks & Skip Navigation:** `a.skip-link` -> `#main-content` (`tabIndex={-1}`) and `RouteErrorBoundary` (`role="alert"`) active across all authenticated routes.
- **Drawer Keyboard Control:** `Escape` key closes the mobile navigation drawer in `AppShell.tsx`.
- **Offline Status Announcement:** `.offline-banner` uses `role="status"` for screen-reader announcements.
- **Reduced Motion & Touch Targets:** `@media (prefers-reduced-motion: reduce)` and `44px` minimum mobile control height enforced in `tokens.css`.
