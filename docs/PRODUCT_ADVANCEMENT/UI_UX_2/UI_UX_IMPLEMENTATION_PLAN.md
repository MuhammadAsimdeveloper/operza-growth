# UI/UX 2.0 Implementation Plan

**Date:** 2026-11-27  
**Stage:** Product Advancement Stage 7

## 1. Execution Plan
1. **Design Tokens & Accessibility Foundations (`apps/web/src/styles/tokens.css`):**
   - Add semantic spacing tokens (`--space-1` through `--space-8`), z-index scale, and `@media (prefers-reduced-motion: reduce)` support.
2. **Shared `@operza/ui` & `apps/web/src/components/ui.tsx`:**
   - Add `Skeleton` and `Alert` primitives with ARIA roles (`role="status"`, `role="alert"`), TypeScript types, and unit tests in `packages/ui/test/ui.test.mjs`.
3. **Standardize Stage 2–6 Workspace Panels:**
   - Repair `request<T>()` calls, `EmptyState` `text=` props, `Badge` tones, and `WorkflowRunStep` typing across `WorkflowGraphV2.tsx`, `IntegrationsHub2Panel.tsx`, `AiStudio2Panel.tsx`, `MarketplaceHub2Panel.tsx`, and `BiStudio2Panel.tsx`.
4. **App Shell & Navigation Accessibility (`apps/web/src/components/AppShell.tsx`):**
   - Add keyboard-accessible skip-to-content link and `#main-content` landmark.
5. **Verification & Documentation:**
   - Run `@operza/ui` tests, `@operza/web` `typecheck` + `build`, `@operza/marketing` `build`, SEO audit, E2E suite, and all platform/workflow unit tests.
