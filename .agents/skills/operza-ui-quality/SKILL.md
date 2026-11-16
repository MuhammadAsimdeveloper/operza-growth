---
name: operza-ui-quality
description: Enforce Operza-specific UI/UX standards, design system tokens, accessible component hierarchy, and deliberate business operations product styling.
---

# Operza UI Quality Standards & Conventions

Use this skill when designing, reviewing, modifying, or creating UI components, pages, forms, tables, and workflows across the Operza application (`apps/web`).

## 1. Operza Product Context & Brand Identity

Operza is a high-velocity **Business Operations, CRM & Workflow Automation Platform** designed for agency operators, business administrators, and team members. 

### Brand Character & Philosophy
- **Personality:** Decisive, engineered, calm, high-density, reliable.
- **Visual Stance:** Workhorse operational software (reminiscent of Linear, Stripe, Grafana, and modern native utilities), NOT a generic AI hype landing page.
- **Rule of Restraint:** Supporting navigation, frame borders, and backgrounds stay quiet so users can focus on actionable customer records, communication threads, and automation logic.

---

## 2. The 10 Core UI Acceptance Standards

### 1. Deliberate Product-Specific Visual Identity
- Never use generic purple/indigo gradient text or decorative neon drop-shadows.
- Avoid gratuitous glassmorphism (frosted glass) unless functionally necessary for modal backdrops.
- Primary actions use deep slate or crisp brand navy (`#0f172a` / `#1e293b`), with accents (`#0284c7` / `#2563eb`) reserved for actionable links and interactive indicators.

### 2. Natural Visual Hierarchy
- Every page must have one clear focal point: the primary operational canvas or data table.
- Use font weight and contrast rather than larger font sizes to denote secondary hierarchy.
- Secondary actions must remain outlined or ghost styled to avoid button competition.

### 3. Strict 4px Spacing Grid & Geometric Alignment
- Spacing values must strictly follow 4px increments (`4px`, `8px`, `12px`, `16px`, `24px`, `32px`).
- Never use arbitrary one-off paddings or margins (`13px`, `27px`, etc.).
- Align table columns, cards, and modal actions along continuous vertical and horizontal baselines.

### 4. Accessible Colors, Contrast & Controls
- Text contrast must exceed WCAG 2.2 AA standards (minimum 4.5:1 for normal text, 3:1 for large text).
- Interactive controls must feature an explicit `2px` focus ring with adequate offset (`ring-2 ring-offset-2 ring-slate-900 dark:ring-slate-100`).
- Status indicators must pair color with text or shape (never rely solely on hue for status).

### 5. Multi-Device Responsive Architecture
- Verify layouts across 4 key breakpoints:
  - Desktop: `1440 × 900` (High information density, expanded sidebar)
  - Laptop: `1280 × 800` (Collapsed sub-panels, scrollable table containers)
  - Tablet: `768 × 1024` (Drawer-based filters, stacked metrics)
  - Mobile: `390 × 844` (Off-canvas navigation, bottom action sheets, horizontal overflow prevention)
- Never shrink desktop cards down to unreadable mobile sizes; refactor to vertical mobile flows.

### 6. Predictable Navigation & Interaction
- Replace decorative emojis in navigation bars with consistent, single-weight iconography (Lucide / Radix icons).
- Maintain persistent active navigation states indicating current route and location context.
- Keep primary navigation quiet and dark/neutral; save high saturation for user attention states.

### 7. Realistic Contextual Content
- Never use placeholder lorem ipsum or fake exaggerated numbers (`$10,000,000 revenue in 3 minutes`).
- Use realistic business entities: customer names, real contact stages (`Lead`, `Discovery`, `Proposal Sent`, `Won`), timestamped events, and realistic deal sizes.

### 8. Direct, Natural Product Copy
- Eliminate AI marketing tropes:
  - ❌ "Supercharge your business with AI magic"
  - ❌ "Revolutionize customer relationships seamlessly"
  - ❌ "Unlock next-generation autonomous workflows"
- Replace with crisp operational labels:
  - ✔ "Automate lead qualification and SMS dispatch"
  - ✔ "Synchronize contacts across CRM pipelines"
  - ✔ "Run execution step with manual manager review"

### 9. Purposeful Motion & Reduced-Motion Compliance
- Transitions must be brief and functional (`150ms` - `200ms` ease-out).
- No floating cards, pulsating status badges without system state changes, or infinite rotating gradient borders.
- Wrap all transitions in `@media (prefers-reduced-motion: reduce)` rules.

### 10. Visual Verification & Quality Gate
- After touching any CSS or component:
  1. Inspect browser console for React hydration or key warnings.
  2. Test interactive states: hover, keyboard focus, active/pressed, disabled, loading.
  3. Validate form error styling with inline error messaging.
  4. Ensure zero horizontal scrollbars on mobile viewports.
