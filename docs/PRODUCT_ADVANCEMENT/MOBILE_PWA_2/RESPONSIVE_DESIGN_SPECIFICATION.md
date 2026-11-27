# Mobile & PWA 2.0 — Responsive Design Specification

- **Safe-Area Tokens (`tokens.css`):** `--safe-top`, `--safe-right`, `--safe-bottom`, `--safe-left` via `env(safe-area-inset-*, 0px)`.
- **Touch Targets (`<= 768px`):** Minimum `44px` height on `.btn`, `button.icon-btn`, `.select`, and `.input` controls.
- **Mobile Copilot Clearance (`<= 640px`):** Compact circular FAB (`padding: 10px`) with `76px` bottom clearance on `#main-content` so bottom action buttons are never obscured.
- **Breakpoints:** Component-driven breakpoints at `768px` (tablet/drawer transition) and `640px` (compact mobile FAB & panel width).
