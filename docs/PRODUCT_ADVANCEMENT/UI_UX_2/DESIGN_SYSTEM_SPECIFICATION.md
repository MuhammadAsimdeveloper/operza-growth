# Operza Design System 2.0 Specification

**Tokens:** `apps/web/src/styles/tokens.css`  
**Shared Package:** `packages/ui/src/components.tsx` & `apps/web/src/components/ui.tsx`

## 1. Color & Theme System
- **Light Theme:** `--bg: #f8f9fa`, `--layer-01: #ffffff`..`--layer-04: #dfe3ea`, `--text: #161616`, `--accent: #2563eb`.
- **Dark Theme (`[data-theme="dark"]`):** `--bg: #090a0f`, `--layer-01: #11141e`, calibrated ink & border contrast.
- **Semantic Status:** `--green` (`#10b981`), `--amber` (`#f59e0b`), `--red` (`#ef4444`), `--blue` (`#3b82f6`), `--violet` (`#8b5cf6`).

## 2. Typography & Spacing
- **Fonts:** `--font` (`Inter`, system sans) and `--font-mono` (`JetBrains Mono`, `Fira Code`).
- **Spacing Scale:** `--space-1` (`4px`), `--space-2` (`8px`), `--space-3` (`12px`), `--space-4` (`16px`), `--space-5` (`20px`), `--space-6` (`24px`), `--space-8` (`32px`).
- **Radii:** `--r-xs` (`4px`) through `--r-2xl` (`20px`) and `--r-pill` (`9999px`).

## 3. Core Components (`@operza/ui` + `ui.tsx`)
`Button`, `Input`, `Select`, `Card`, `LoadingState`, `ErrorState`, `Pagination`, `Skeleton`, `Alert`, `Avatar`, `Badge`, `StatusBadge`, `EmptyState`, `Switch`.
