# Frontend Performance Report — UI/UX 2.0

## 1. Code Splitting & Caching
- **Route-Level Lazy Loading (`apps/web/src/App.tsx`):** All marketing, public, and protected workspace routes use `React.lazy(...)` with `<Suspense fallback={<PageLoadingFallback />}>`.
- **TanStack Query & Tenant Isolation:** Stage 1–7 panels use TanStack Query (`useQuery`) with structured query keys; `AuthContext` clears `queryClient.clear()` and PWA caches on `logout()` and `switchLocation()`.
- **Build Output:** Verified via `npm --workspace=@operza/web run typecheck` (`tsc -b --noEmit`) and `npm --workspace=@operza/web run build` (`vite build` + `prerender-public-routes.mjs`).
