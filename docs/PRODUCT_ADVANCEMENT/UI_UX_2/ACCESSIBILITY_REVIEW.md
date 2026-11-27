# Accessibility Review (WCAG 2.2 AA) — UI/UX 2.0

## 1. Controls Implemented & Verified
- **Keyboard Navigation:** Skip-to-main-content link (`.skip-link` -> `#main-content`) in `AppShell.tsx`, `Ctrl+K` / `Escape` handling in `CommandPalette.tsx` and dropdowns, and keyboard shortcuts (`Ctrl+Z/Y/C/V`, `Delete`) in `WorkflowGraphV2.tsx`.
- **Focus & Motion:** High-contrast `--focus-ring` in both Light and Dark themes (`tokens.css`) and `@media (prefers-reduced-motion: reduce)` disabling animations/transitions for motion-sensitive users.
- **ARIA & Semantic Roles:** `Alert` uses `role="alert"`/`role="status"`, `LoadingState` uses `aria-live="polite"`, `Input`/`Select` bind `<label htmlFor>` and `role="alert"` error messages, `Button` sets `aria-busy`, and `Pagination` wraps controls in `<nav aria-label="Pagination">`.
- **Known Limitations:** Live automated browser axe-core / screen-reader testing across all 50+ routes was not executed in this headless CLI environment.
