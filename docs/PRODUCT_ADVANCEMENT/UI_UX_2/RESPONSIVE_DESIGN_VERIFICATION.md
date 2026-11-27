# Responsive Design Verification — UI/UX 2.0

## 1. Breakpoints & Layout Patterns
- **1920×1080 & 1440×900 (Desktop):** Full sidebar (`--sidebar-w: 248px`), 3-pane Workflow Studio 2.0 (`220px | 1fr | 260px`), multi-column KPI and catalog grids (`repeat(auto-fill, minmax(260px, 1fr))`).
- **1366×768 (Laptop):** Compact topbar (`--topbar-h: 56px`), flexible wrapping toolbars (`flexWrap: 'wrap'`), scrollable horizontal tables.
- **768×1024 (Tablet) & 390×844 (Mobile):** Collapsible mobile navigation drawer in `AppShell.tsx` and auto-fit CSS grids (`minmax(180px, 1fr)` / `minmax(240px, 1fr)`).
