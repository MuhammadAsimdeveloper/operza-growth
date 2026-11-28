# UX, Accessibility (WCAG 2.2 AA) & Mobile Audit

## 1. Automated Browser & Responsive Verification

- **Tooling:** Headless Chromium (`chromium-1248`) via `stage18_playwright.mjs` against production-built `@operza/web` (`dist/`) proxied to `apps/api/server.mjs`.
- **Viewports Tested (6):** `1920x1080`, `1440x900`, `1366x768`, `768x1024`, `390x844`, `360x800`.
- **Routes Tested (16):** `/dashboard`, `/crm`, `/customer-360`, `/conversations`, `/campaigns`, `/workflows`, `/workflow-operations`, `/integrations`, `/ai-studio`, `/commerce`, `/websites`, `/portal`, `/reporting`, `/settings`, `/audit-log`, `/plan-usage`.
- **Results:** **96/96 checks passed** (`overflowCount=0`, `pageErrorsCount=0`, `unauthRedirected=true`, `badgeVisible=true`).
- **Screenshot Inspection:** Verified desktop (`1440x900`) and mobile (`390x844`) captures on `/reporting` and `/dashboard`: clean sidebar drawer collapse on mobile, legible typography, explicit `Local Dev Fallback (Non-Authoritative)` badge & warning banner visible without clipping.

## 2. Accessibility (WCAG 2.2 AA) Codebase Audit

- **Semantic & ARIA Coverage (`apps/web/src/`):** `232` `aria-*` attributes, `29` `role=` attributes, and `3` `prefers-reduced-motion` CSS/component rules.
- **Confirmed Strengths:**
  - Keyboard-accessible `CommandPalette` (`Cmd/Ctrl+K`) and skip/tutorial dismiss controls.
  - Consistent form labels (`<label>`) and focus-visible rings across Design System 2.0 primitives (`@operza/ui`).
  - Honest error/warning banners (`BiStudio2Panel.tsx`, `401`/`403`/`503` handling).
- **Remaining UX / A11y Gaps (Non-Blocking for Local RC1, Tracked for Staging):**
  - Full screen-reader (NVDA/VoiceOver) and automated `axe-core` contrast sweep across all 74 pages has not yet been run in CI.
  - Real physical iOS/Android PWA install & push-notification testing remains unverified locally.
