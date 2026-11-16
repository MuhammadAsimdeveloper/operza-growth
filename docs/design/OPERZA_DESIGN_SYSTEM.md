# Operza Design System Specification

**Document ID:** `DESIGN-SYSTEM-SPEC-001`  
**Subsystem:** Typography, Color, Spacing, Micro-Interactions, Component Guidelines  
**Date:** November 9, 2026  
**Status:** **ACTIVE / PRODUCTION SPECIFICATION**  

---

## 1. Design Principles

1. **Quiet Chrome, Meaningful Data:** Navigation, sidebars, headers, and card containers stay neutral and low-contrast so user data (contacts, financial ledgers, conversation threads, workflow graphs) forms the focal point.
2. **Predictable 4px Spacing Rhythm:** All margins, paddings, gaps, and heights strictly adhere to 4px multiples.
3. **Restrained Color Hierarchy:** One primary interactive brand accent (`#2563eb`), three neutral text levels, and purposeful semantic status hues.
4. **Tactile Precision:** Hairline borders (`1px solid var(--border-base)`), subtle 6px corner radii, and zero decorative glowing shadows.
5. **Universal Accessibility:** WCAG 2.2 AA compliant contrast floors, keyboard-navigable focus rings, and full reduced-motion support.

---

## 2. Color System

### 2.1 Neutral Surfaces (Graphite & Slate Ramps)

| Token | Light Theme | Dark Theme | Purpose |
|---|---|---|---|
| `--bg` | `#f8f9fa` | `#0b0f17` | Application viewport background |
| `--layer-01` | `#ffffff` | `#111827` | Primary surface / card background |
| `--layer-02` | `#f1f5f9` | `#1e293b` | Secondary surface / table header / inputs |
| `--layer-03` | `#e2e8f0` | `#334155` | Elevated dialogs / popovers |
| `--sidebar` | `#ffffff` | `#0f172a` | Main navigation shell |

### 2.2 Typography Ink

| Role | Light Theme | Dark Theme | Contrast Ratio |
|---|---|---|---|
| **Primary Ink (`--text`)** | `#0f172a` | `#f8fafc` | `> 12:1` (High readability) |
| **Secondary Ink (`--text-2`)** | `#475569` | `#94a3b8` | `> 5.5:1` (Secondary info) |
| **Muted Ink (`--text-3`)** | `#64748b` | `#64748b` | `> 4.5:1` (Metadata, timestamps) |

### 2.3 Interactive Brand Accent & Semantics

| Token | Hex Value | Usage |
|---|---|---|
| `--accent` | `#2563eb` (Royal Blue) | Primary button, active tab indicator, links |
| `--accent-hover` | `#1d4ed8` | Hover / active pressed state on accent |
| `--accent-soft` | `rgba(37, 99, 235, 0.08)` | Selected row background, subtle tag background |
| `--green` | `#059669` (Emerald) | Positive trends, 'Paid', 'Confirmed', 'Healthy' |
| `--amber` | `#d97706` (Amber) | Attention needed, 'Pending', 'Waiting Approval' |
| `--red` | `#dc2626` (Crimson) | Destructive action, 'Failed', 'Cancelled', errors |

---

## 3. Typography Scale & Hierarchy

- **Base Font Family:** `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **Monospace Family:** `"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace`

| Scale | Size | Line Height | Weight | Usage |
|---|---|---|---|---|
| **Display Heading** | `22px` | `28px` | `700` | Major page overview header |
| **Section Title** | `16px` | `22px` | `650` | Card header, modal title |
| **Subsection / Card** | `14px` | `20px` | `600` | Group labels, table column headers |
| **Body Default** | `13.5px` | `20px` | `400` | Standard table cell, form text |
| **Caption / Meta** | `11.5px` | `16px` | `500` | Timestamps, status pills, helper text |
| **Monospace Telemetry**| `12px` | `16px` | `500` | JSON keys, code tokens, IDs, latencies |

---

## 4. Spacing System (4px Base Grid)

- `space-1`: `4px` (Tight padding inside badges, icons)
- `space-2`: `8px` (Gaps between buttons in toolbar, input internal padding)
- `space-3`: `12px` (Sidebar item vertical padding, table row vertical padding)
- `space-4`: `16px` (Card inner padding, standard component margins)
- `space-6`: `24px` (Page gutter, section spacing)
- `space-8`: `32px` (Major structural layout gaps)

---

## 5. Components & Interaction States

### 5.1 Buttons
- **Primary:** Background `--accent`, text `#ffffff`, border `none`, shadow `0 1px 2px rgba(0,0,0,0.06)`.
- **Secondary / Outline:** Background `--surface`, text `--text`, border `1px solid var(--border-base)`. Hover: `--surface-2`.
- **Ghost:** Background `transparent`, text `--text-2`. Hover: background `--surface-2`, text `--text`.
- **Destructive:** Background `--red`, text `#ffffff`.
- **Focus State:** `outline: 2px solid var(--accent); outline-offset: 2px;`.

### 5.2 Badges & Status Pills
- Form factor: `height: 20px`, `padding: 0 8px`, `font-size: 11px`, `font-weight: 550`, `border-radius: 4px` (no exaggerated pill shapes on operational tables).
- Tones: Light background with high-contrast text and a solid 6px status dot.

### 5.3 Form Inputs
- Height: `34px`, border: `1px solid var(--border-base)`, background: `var(--surface)`, border-radius: `6px`.
- Active focus: `border-color: var(--accent)`, box-shadow: `0 0 0 1px var(--accent)`.

### 5.4 Data Tables
- Header: `background: var(--surface-2)`, `height: 36px`, `font-size: 12px`, uppercase letter-spacing `0.02em`, `color: var(--text-2)`.
- Rows: `height: 42px`, `border-bottom: 1px solid var(--border-base)`.
- Hover state: Subtle background tint (`var(--surface-2)`), zero scale or 3D transform.

---

## 6. Motion & Animation Standards

1. **Duration:** Functional micro-interactions run at `150ms` (hover) or `200ms` (modals).
2. **Easing:** `cubic-bezier(0.16, 1, 0.3, 1)` (fast out, smooth settle).
3. **No Decorative Jitter:** Eliminate continuous floating animations, blur pulsing, and decorative radar sweeps.
4. **Reduced Motion:**
   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after {
       animation-duration: 0.01ms !important;
       animation-iteration-count: 1 !important;
       transition-duration: 0.01ms !important;
     }
   }
   ```
