# Operza UI/UX Unslop Audit Report

**Document ID:** `DESIGN-UNSLOP-AUDIT-001`  
**Framework:** `heydamir/unslop` (CC BY 4.0, Damir Sokolovsky)  
**Date:** November 9, 2026  
**Auditor:** Principal Product Designer & Design Engineer  

---

## 1. Executive Summary

This audit evaluates the Operza user interface (`apps/web`) against the official `heydamir/unslop` catalog of AI-generated design patterns ("signs of slop"). 

While Operza possesses robust relational business logic and comprehensive route coverage across CRM, telephony, visual workflows, and agency administration, its presentation layer accumulated heavy AI-generated visual tropes:
- Neon violet/indigo gradient buttons with diffuse 24px glow shadows (`--accent-glow`).
- Unnecessary glassmorphism with heavy blur (`backdrop-filter: blur(20px) saturate(190%)`).
- Floating continuous 3D transforms (`@keyframes floatSlow`, `perspective: 1200px rotateX(2deg)`).
- Decorative blurred color blobs (`@keyframes glowPulseSlow` with `filter: blur(56px)`).
- Emojis utilized as primary navigation and category indicators (`⚡`, `🤖`, `📞`, `🔒`, `📊`).
- Exaggerated, enthusiastic copy ("AI swarm", "Unified control plane", "50+ Catalog ↗").
- Uneven card border-radii (`--r-pill: 9999px` applied to status chips and cards).

This audit documents each detected issue, defines the foundational design direction, and tracks the systematic remediation across shared tokens, components, and primary operational screens.

---

## 2. The Five Direction Statements

Following the upstream `unslop` methodology:

1. **Product:**  
   A multi-tenant agency CRM, customer communication terminal, and deterministic workflow execution engine for business operators.
2. **Character:**  
   **Engineered. Decisive. Composed.** (Not hyped, not decorative, not playful).
3. **World:**  
   The quiet command bridge of modern operational infrastructure: dense tabular records, calm graphite and slate surfaces, crisp hairlines, and legible monospace telemetry.
4. **Moments:**  
   - *The Visual Workflow Canvas:* High-contrast orthogonal lines, deliberate node states (Draft, Running, Awaiting Approval), and clean parameter inspectors.
   - *The Customer Timeline:* Linear, timestamped omnichannel events with clear delivery verification and zero decorative clutter.
5. **Signature:**  
   A restrained **dual-tone hairline container system** (`1px solid var(--border-base)` at 8% opacity) paired with tabular numbers (`tabular-nums`) and subtle 6px corner radii on all interactive operational tiles.

---

## 3. Comprehensive Slop Inventory by Surface

### 3.1 Global Shell & Design Tokens (`tokens.css` & `app.css`)
- **Signs Detected:**
  - `tokens.css:42`: `--accent-glow: 0 0 24px rgba(79, 70, 229, 0.25)` adds distracting halo around primary controls.
  - `tokens.css:26`: `--glass-blur: blur(20px) saturate(190%)` applied globally to topbars and modals, degrading scrolling performance and illegibly blending text over charts.
  - `tokens.css:76`: `--motion-bounce: cubic-bezier(0.34, 1.56, 0.64, 1)` creates playful spring overshoot unsuited for professional financial or CRM tooling.
  - `app.css:3458`: `@keyframes atlasGlowPulse` creates continuous pulsing box-shadows.
  - `app.css:3635`: `@keyframes glowPulseSlow` with `filter: blur(56px)` generates fuzzy decorative neon blobs.
  - `app.css:3720`: `.text-shimmer` uses a 5-stop animated linear gradient for text headings.
  - `app.css:3680`: `.card-3d-interactive:hover` applies `perspective(1000px) rotateX(2deg) rotateY(-1deg)` causing jitter on dense table hover rows.

### 3.2 Navigation & Application Shell (`AppShell.tsx`)
- **Signs Detected:**
  - Emojis embedded in interactive tools and catalog triggers (`50+ Catalog ↗`, `✨ Copilot`).
  - Brand mark using hyper-saturated multi-hue gradient (`linear-gradient(135deg, #4f46e5, #7c3aed)`).
  - Search trigger badge cluttering the sidebar header.
  - Competing badge pills with arbitrary color combinations.

### 3.3 Main Dashboard (`Dashboard.tsx`)
- **Signs Detected:**
  - Exaggerated hero greeting: *"Run the business from one unified control plane."*
  - Arbitrary percentage trends (`+14%`, `+28%`) decoupled from real timeframe windows.
  - Glowing KPI cards (`0 0 20px rgba(99, 102, 241, 0.18)` on hover).
  - Multi-hue pipeline stages using 5 saturated neon colors (`#6366f1`, `#3b82f6`, `#8b5cf6`, `#ec4899`, `#10b981`).

### 3.4 Visual Workflow Canvas (`WorkflowCanvas.tsx`)
- **Signs Detected:**
  - Glowing node borders (`0 0 15px rgba(99, 102, 241, 0.25)`).
  - Multi-hue neon wire connector gradients (`neonWireGrad` stop `#6366f1` to `#06b6d4`).
  - Floating action badges with inconsistent padding.

### 3.5 Marketing & Landing Pages (`Home.tsx`, `About.tsx`)
- **Signs Detected:**
  - `hero3dGlow1` & `hero3dGlow2`: Fixed radial blur blobs floating behind the viewport.
  - Simulated console window containing emojis: `⚡ Visual Nodal Graph`, `🤖 Copilot AI Swarm`, `📞 WebRTC Softphone`.
  - Overly enthusiastic copy: *"Autonomous Multi-Step AI Agent with Approval Gate"*, *"Next-generation intelligence"*.

---

## 4. Remediation Architecture & Action Plan

| Layer | Unslopped Standard | Target Files |
|---|---|---|
| **Tokens** | Neutralize glows, eliminate spring bounce, replace glass blur with solid tinted surfaces. | `apps/web/src/styles/tokens.css` |
| **CSS Utilities** | Remove `@keyframes glowPulseSlow`, `@keyframes atlasGlowPulse`, `.text-shimmer`, 3D card tilt. | `apps/web/src/styles/app.css` |
| **App Shell** | Clean, quiet sidebar with consistent 16px SVG line icons, zero emojis, solid brand badge. | `apps/web/src/components/AppShell.tsx` |
| **UI Components** | Subtle hairline borders, crisp focus rings, muted semantic status badges. | `apps/web/src/components/ui.tsx` |
| **Dashboard** | Operational KPI tiles with real timestamp scopes, clean tabular figures, calm funnel stages. | `apps/web/src/pages/Dashboard.tsx` |
| **Workflow Canvas**| Clean solid orthogonal wires, crisp 1px bordered nodes, high-legibility execution badges. | `apps/web/src/components/WorkflowCanvas.tsx` |
| **Marketing Pages**| Remove ambient glowing blobs and 3D tilt frames; replace with clean product UI previews. | `apps/web/src/pages/marketing/Home.tsx` |

---

## 5. Audit Verdict

Operza's underlying application mechanics are well-engineered and feature-complete. Eliminating the cosmetic AI slop transforms Operza into a disciplined, high-density, professional business operations workstation.
