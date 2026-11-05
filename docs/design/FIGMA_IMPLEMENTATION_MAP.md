# OPERZA — FIGMA IMPLEMENTATION MAP (ATLAS DESKTOP CONTROL CENTER)

**Reference Design:** [Atlas Desktop Control Center (Figma)](https://www.figma.com/design/PrrVxX6q5KIUtxlXLHSala/Atlas-Desktop-Control-Center?node-id=1-60&t=zEEq9j0vrZuVozjU-0)  
**File Key:** `PrrVxX6q5KIUtxlXLHSala`  
**Primary Root Frame:** Node `1:60` (Atlas Desktop Control Center — Unified Workspace)  

---

## 1. Design Philosophy & Visual Language

Operza implements an original, high-density, control-center visual identity tailored for business operators, agencies, and automation engineers.

### Core Design Pillars:
1. **Control-Center Ergonomics:** 3-tier layout (Global Navigation Rail, Contextual Top Bar, Infinite Canvas / Master Workspace).
2. **Subtle Elevation & Contrast:** Obsidian `#090d16` canvas backdrop with slate `#131b2e` raised cards, 1px frosted borders (`rgba(255, 255, 255, 0.08)`), and soft radial glow highlights.
3. **Signal Accents:** High-visibility coral/orange (`#f97316`) for primary triggers and execution CTA; emerald (`#10b981`) for active/connected status; amber (`#f59e0b`) for approval gates and warnings.
4. **Data-Dense Typography:** Crisp sans-serif font stack with tabular figures (`font-variant-numeric: tabular-nums`) for currency amounts, pipeline probabilities, and execution timestamps.

---

## 2. Design System Tokens Mapping

```css
:root {
  /* Surface Tokens */
  --bg-app: #090d16;
  --bg-surface: #0f172a;
  --bg-surface-elevated: #131b2e;
  --bg-surface-hover: #1e293b;
  
  /* Border Tokens */
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-contrast: rgba(255, 255, 255, 0.16);
  --border-focus: #f97316;
  
  /* Text Tokens */
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --text-inverse: #090d16;
  
  /* Brand & Status Accents */
  --color-primary: #f97316;
  --color-primary-hover: #ea580c;
  --color-primary-subtle: rgba(249, 115, 22, 0.12);
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --color-info: #3b82f6;

  /* Typography */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', Menlo, monospace;

  /* Radii */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-full: 9999px;
  
  /* Shadows */
  --shadow-card: 0 4px 20px -2px rgba(0, 0, 0, 0.5);
  --shadow-elevated: 0 10px 30px -5px rgba(0, 0, 0, 0.65);
}
```

---

## 3. Screen & Component Architecture Map

### A. Global AppShell (`apps/web/src/components/AppShell.tsx`)
- **Figma Frame:** Left Sidebar Navigation & Header Bar
- **Implementation:**
  - Collapsible domain groups:
    - *Operations:* CRM Contacts, Companies, Opportunities & Pipelines, Tasks, Calendars.
    - *Automation:* Workflow Canvas, Templates, Webhook Triggers, Executions Ledger.
    - *Conversations:* Omnichannel Inbox (Email, SMS, WhatsApp, Meta), AI Webchat Widget.
    - *Commerce:* Invoices, Orders, Payment Links, Subscriptions, Coupons.
    - *Growth:* Funnels & Websites, Forms, Surveys, Email Campaigns.
    - *Agency Platform:* Sub-Accounts, Snapshots, Audit Log, White-Label Portal, Integrations, Settings.
  - Workspace Switcher: Dropdown with sub-account filtering and multi-location pills.
  - Miss Minutes Copilot mascot icon in bottom rail with status glow indicator.

### B. Command Palette (`apps/web/src/components/CommandPalette.tsx`)
- **Shortcut:** `⌘K` / `Ctrl+K`
- **Features:** Fuzzy search across all 28 collections, navigation jump links, quick contact creation, workflow execution trigger.

### C. Signature Workflow Builder (`apps/web/src/pages/Workflows.tsx` & `WorkflowCanvas.tsx`)
- **Figma Frame:** Control Center Node Canvas & Properties Drawer
- **Implementation:**
  - Interactive grid canvas with wheel zoom and pan gestures.
  - Draggable Node Palette categorized by Trigger, Logic, Action, and AI Agent.
  - Smooth SVG bezier connectors with directional arrows.
  - Top Toolbar: Undo/Redo, Zoom to Fit, Test Step, Run Workflow, Publish Status toggle.
  - Right Collapsible Inspector: Step configuration form, variable picker (`{{ contact.email }}`), retry settings, and execution timeline.

### D. Commerce & Checkout (`apps/web/src/pages/PublicCheckout.tsx`)
- **Figma Frame:** Minimalist Hosted Checkout Flow
- **Implementation:**
  - Two-phase checkout (Pending Order -> Session Creation -> Webhook Paid Confirmation).
  - Clean order summary card with 1-click bump offer and coupon validation preview.
