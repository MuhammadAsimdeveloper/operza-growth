# Operza Phase 11: Atlas Control Center & High-Performance UI Design System

## 1. Executive Summary & Design Reference

Phase 11 unifies Operza's visual design with the **Atlas Desktop Control Center** (Figma Reference: `https://www.figma.com/design/PrrVxX6q5KIUtxlXLHSala/Atlas-Desktop-Control-Center`). Rather than running two separate applications, Operza adopts the high-density, tactile executive dashboard, dark/light theme tokens, and persistent chrome navigation into one cohesive application shell.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               OPERZA UNIFIED CONTROL SHELL                              │
├─────────────────┬───────────────────────────────────────────────────────────────────────┤
│                 │ Persistent Topbar: Search [⌘K] | Sub-Account Switcher | Notifications │
│ SIDEBAR         ├───────────────────────────────────────────────────────────────────────┤
│ NAVIGATION      │                                                                       │
│                 │ Executive KPI Row: Contacts | Deals | Revenue | Bookings | Runs       │
│ • Dashboard     │ ───────────────────────────────────────────────────────────────────── │
│ • Contacts      │ Interactive Pipeline Deal Velocity:                                   │
│ • Opportunities │   Lead Capture ──> Qualified ──> Proposal Sent ──> Won                │
│ • Conversations │ ───────────────────────────────────────────────────────────────────── │
│ • Workflows     │ Real-time Activity Feed & Glassmorphic Floating Copilot Swarm Hub    │
│ • Commerce      │                                                                       │
└─────────────────┴───────────────────────────────────────────────────────────────────────┘
```

---

## 2. Design System Tokens & Tactile Controls

### 2.1 Tokens (`apps/web/src/styles/tokens.css`)
- **Specular Inner Highlights:** Enforces Linear/Stripe-caliber surface highlights:
  - Light mode: `--shadow-specular: inset 0 1px 0 rgba(255, 255, 255, 0.85)`
  - Dark mode: `--shadow-specular: inset 0 1px 0 rgba(255, 255, 255, 0.08)`
- **Glassmorphism:** `--glass-bg: rgba(255, 255, 255, 0.72)` / `rgba(18, 20, 29, 0.82)` with `--glass-blur: blur(20px) saturate(180%)`.
- **Concentric Radius Scale:** `--r-xs` (3px), `--r-sm` (6px), `--r-md` (8px), `--r-lg` (12px), `--r-xl` (16px), `--r-pill` (9999px).
- **Ambient Glow:** `--accent-glow: 0 0 24px rgba(79, 70, 229, 0.22)`.

### 2.2 Global Typography & Tactile Interactions (`apps/web/src/styles/app.css`)
- **Modern Heading Geometry:** `-0.025em` letter-spacing with `text-wrap: balance` on all headings.
- **Body Text:** `text-wrap: pretty` for elegant multiline justification.
- **Universal Tabular Numerics:** Enforces `font-variant-numeric: tabular-nums` on financial values, counts, and percentages.
- **Tactile Button Physics:** Cubic-bezier micro-compression (`transform: scale(0.975)`) on click states.

---

## 3. Persistent Shell & Navigation Continuity

- **Shell Continuity:** Eliminated desktop layout-thrashing rule (`.shell--overview .topbar { display: none; }` &rarr; `display: flex;`). The 58px topbar remains strictly persistent across dashboard overview, CRM, workflows, telephony, and commerce modules.
- **Global Quick Search (`⌘K` / `Ctrl+K`):** Integrated keyboard event listener in `AppShell.tsx` and visual `<kbd>` badge in the header search input.
- **Brand Consistency:** Completely purged residual "Atlas" branding strings (`openAtlasCopilot` &rarr; `openOperzaCopilot`, `atlas-dashboard` &rarr; `operza-dashboard`), presenting ONE unified brand identity.

---

## 4. Real Business KPIs & Deal Velocity Engine

- **Executive KPI Cards:** Total Contacts, Pipeline Value, Invoiced Revenue, Today's Bookings, Pending Tasks, Unread Conversations, and Workflow Executions with SVG micro-sparklines and percentage trend indicators.
- **Pipeline Deal Velocity:** Renders conversion throughput across CRM stages:
  - Lead Capture &rarr; Qualified &rarr; Proposal Sent &rarr; Negotiation &rarr; Closed Won.
  - Computes conversion rates and stage distribution from real database records without synthetic numbers.

---

## 5. Verification Evidence

- `apps/web/src/pages/Dashboard.tsx` (Clean render, zero console errors)
- Clean production bundle (`vite build` completed in 8.72s)
- End-to-End System Tests:
  - `[TEST 6] Dashboard Multi-Tenant Scoping & KPI Isolation` (PASSED)
  - `[TEST 85] Flagship Business Journey: CRM -> Velocity -> Pipeline -> Reporting` (PASSED)
