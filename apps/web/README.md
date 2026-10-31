# @operza/web

The official frontend web application for Operza: a modern, enterprise-grade React 19 + TypeScript + Vite CRM workspace engineered with exceptional usability and aesthetic polish.

---

## 🎨 Key Features & Components

### 1. Visual Workflow Graph Canvas (`WorkflowCanvas.tsx`)
- **2D Node Canvas:** Full 2D node-and-wire visual graph canvas with interactive panning and zooming (40% to 200%).
- **Interactive Node Graph:** Draggable trigger, condition, action, wait, and approval nodes.
- **Dynamic Connection Wires:** High-precision SVG cubic bezier curving wires with directional arrows and pulsing dash stroke animations.
- **Color-Coded Branching:** `YES` branch rendered in emerald green, `NO` branch rendered in red.
- **Dual-Mode Switching:** Seamless 1-click toggle between **Visual Graph (Canvas Mode)** and **Step List (Tree Mode)**.

### 2. In-Browser Visual Funnel Page Builder (`VisualPageBuilder.tsx`)
- **Full WYSIWYG Editor:** Element-level drag-and-drop page editor for high-converting funnels and landing pages.
- **Rich Component Palette:** Headlines, Body Copy, Hero Images, 2-Column Responsive Grids, Countdown Timers, 1-Click Order Bumps, Call-to-Action Buttons, and Customer Testimonials.
- **Responsive Viewport Inspector:** Instant switching between Desktop (100%), Tablet (768px), and Mobile (375px) viewports.
- **Direct Funnel Integration:** Launched directly from the Funnels step table via the **"Design Canvas"** trigger.

### 3. CRM Modules (25+ Views)
- **Pipelines Kanban:** Drag-and-drop lead stage progression with monetary deal totals.
- **Smart Lists & Contacts:** Multi-criteria tagging, contact filtering, and CSV export.
- **Omnichannel Inbox:** Unified timeline for SMS, phone calls, webchat, and email.
- **Calendar & Appointments:** Interactive availability slots with automatic reminder dispatch.
- **Invoices & Payments:** Stripe-integrated checkout, order bump billing, and e-signatures.
- **Agency Settings & Snapshots:** 1-click deployment of workflow templates to new sub-accounts.
- **Client Portal:** Client-facing view for payment, invoices, and course curriculum LMS.

### 4. Floating AI Copilot Widget
- Persistent floating action button on every page.
- Real-time token streaming over Server-Sent Events (SSE).
- Visual notification badge whenever a background workflow pauses for human approval.

---

## 🛠️ Tech Stack

- **Framework:** React 19 + Vite 5
- **Language:** TypeScript 5.6 (Strict Type Checking)
- **Routing:** React Router v6
- **Styling:** Tailwind CSS + Lucide Icons
- **Bundler:** Vite with multi-stage production Docker container

---

## 🚀 Development & Build

```bash
# Start Vite development server on port 5173
npm run dev

# Run TypeScript typechecker
npm run typecheck

# Build optimized production bundle to /dist
npm run build

# Preview production build locally
npm run preview
```
