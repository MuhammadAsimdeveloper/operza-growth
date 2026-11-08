# OPERZA PRIVATE BETA VALIDATION: BROWSER DEFECT REGISTER

**Document Reference:** `docs/engineering/PRIVATE_BETA_VALIDATION/BROWSER_DEFECT_REGISTER.md`
**Audit Date:** November 8, 2026
**Auditor Roles:** Senior QA Engineer, Application Security Reviewer, Staff Backend Engineer
**Canonical Repository:** `MuhammadAsimdeveloper/operza-growth`
**Branch:** `feat/operza-unified-atlas-automation` (`389aae8`)

---

## 1. Defect Classification Standard

- **P0 — Critical:** Active security vulnerability, cross-tenant data leakage, database corruption, or fatal platform crash across all users.
- **P1 — High:** Major user journey blocked, unhandled process crash on standard browser usage, or release-blocking defect for private beta.
- **P2 — Medium:** Feature functionality impaired, missing fallback, or significant usability friction.
- **P3 — Low:** Minor visual inconsistency, styling anomaly, or non-blocking typo.
- **P4 — Future:** Architectural refactoring or post-launch optimization.

---

## 2. Browser QA Defects Register

### Defect BDF-01 (Priority P1 — High): Unhandled Server Crash on Cold Browser Session Check (`ERR_HTTP_HEADERS_SENT`)

- **Classification:** **P1 (High / Pre-Beta Release Blocker)**
- **Component:** Backend Authentication Ingress (`apps/api/routes/auth.mjs` & `apps/api/server.mjs`)
- **Discovered In:** Real Browser QA Test `BQA-03`
- **Screenshot Evidence:** `BQA-03_desktop.png`

#### Problem Description:
When a real browser visits Operza cold (without pre-existing session cookies), `apps/web/src/lib/AuthContext.tsx` automatically issues a background `GET /api/auth/session` request on initial mount.
In `apps/api/routes/auth.mjs:469`, when `actor` is null, the handler calls:
```javascript
if (!actor) return sendJson(res, 401, { error: 'Not authenticated' });
```
Because the `sendJson` helper function terminates with `res.end(...)` and does not return a value (`undefined`), the expression `return sendJson(...)` returns `undefined`.
In `apps/api/server.mjs:4336`:
```javascript
if (await handleAuthRoutes(req, res, { ... })) {
  return;
}
```
Because `handleAuthRoutes` returns `undefined` instead of `true`, `server.mjs` assumes the route was NOT handled and continues execution down through the file to line 4345:
```javascript
const actor = getActor(req);
if (!actor) return sendJson(res, 401, { error: 'Authentication required' });
```
Line 4345 calls `sendJson(res, 401, ...)` a **second time** on the same HTTP response object. This throws:
```text
Error [ERR_HTTP_HEADERS_SENT]: Cannot write headers after they are sent to the client
    at ServerResponse.writeHead (node:_http_server:411:11)
    at sendJson (server.mjs:614:7)
    at server.mjs:4345:24
```
The error is caught by `server.mjs:8807`'s `catch (error)` block, which then calls `sendJson(res, 500, ...)` a **third time** at line 8815. Attempting to write headers a third time inside the catch block causes an unhandled exception that **crashes the entire Node.js server process**.

#### User & Business Impact:
Any new user or unauthenticated client opening the application crashes the backend server on the initial page load, preventing them from registering, logging in, or loading protected resources until the server process is restarted.

#### Technical Root Cause:
1. `sendJson` does not return `true` upon sending a response.
2. `sendJson` lacks a guard check: `if (res.headersSent) return true;`.
3. Handlers in `routes/auth.mjs` (and `routes/crm.mjs`) use `return sendJson(...)` assuming it returns a truthy value to the caller.

#### Exact Proposed Remediation (To be implemented post-audit):
1. In `apps/api/server.mjs:610`, add a guard to `sendJson`:
   ```javascript
   function sendJson(res, status, body, headers = {}) {
     if (res.headersSent) return true;
     // ... existing writeHead and end ...
     return true;
   }
   ```
2. In `apps/api/routes/auth.mjs:469`, ensure explicit boolean returns:
   ```javascript
   if (!actor) {
     sendJson(res, 401, { error: 'Not authenticated' });
     return true;
   }
   ```
3. Apply the same pattern across all route files where `return sendJson(...)` is currently used.

---

### Defect BDF-02 (Priority P2 — Medium): Missing Automatic Navigation Collapse in Workspace Sidebar

- **Classification:** **P2 (Medium / Usability Friction)**
- **Component:** Frontend Navigation Sidebar (`apps/web/src/components/AppShell.tsx`)
- **Discovered In:** Browser QA Test `BQA-04` & `BQA-19`
- **Screenshot Evidence:** `BQA-04_desktop.png`, `BQA-19_tablet.png`

#### Problem Description:
The AppShell sidebar renders 6 suite accordion pillars (CRM, Marketing, Automation, Commerce, Experience, Platform). Expanding multiple pillars causes the sidebar navigation list to extend beyond 1,200px in height. On standard laptop viewports (1440x900) or tablets (768x1024), the bottom-most navigation items (`Platform Settings`, `Branding`, `Developers`) are pushed below the visible viewport, requiring continuous vertical scrolling.

#### User & Business Impact:
Agency administrators have difficulty discovering platform configuration settings without searching in the menu filter bar.

#### Proposed Remediation:
In `AppShell.tsx`, enforce single-accordion mode by default: when an operator expands a pillar accordion, automatically collapse inactive pillars unless explicitly toggled in multi-expand mode.

---

### Defect BDF-03 (Priority P2 — Medium): Media Library Asset Persistence is Ephemeral

- **Classification:** **P2 (Medium / Infrastructure)**
- **Component:** Media Asset Storage (`apps/api/server.mjs:3420`)
- **Discovered In:** Backend traceability and storage inspection

#### Problem Description:
The `/api/media/upload` endpoint stores asset buffers in `state.mediaFiles[assetId]` in memory or on local disk. When Operza is deployed inside containerized staging or production environments (Docker / AWS ECS / Kubernetes), uploaded files are wiped whenever a container restarts or auto-scales.

#### User & Business Impact:
Agency marketing funnel images and PDF agreements uploaded by clients can disappear following automated platform deployments.

#### Proposed Remediation:
Implement an S3/Cloudflare R2 storage provider adapter in `packages/platform-core/src/media-storage.mjs` with pre-signed upload URLs and CDN delivery.

---

### Defect BDF-04 (Priority P3 — Low): Warning Log on Funnel Public Ingress Page

- **Classification:** **P3 (Low / Console Cleanliness)**
- **Component:** Funnel Checkout Client (`apps/web/src/pages/PublicFunnel.tsx`)
- **Discovered In:** Browser QA Test `BQA-15`
- **Screenshot Evidence:** `BQA-15_desktop.png`

#### Problem Description:
Rendering `http://127.0.0.1:5173/funnel/growth-summit` produces 2 browser console warnings regarding undefined image source placeholders in the order bump card when no image is uploaded.

#### Proposed Remediation:
Add a fallback SVG icon when `step.bumpImage` is undefined in `PublicFunnel.tsx`.

---

## 3. Defect Summary Table

| Defect ID | Priority | Module | Summary | Status |
|---|---|---|---|---|
| **BDF-01** | **P1 (High)** | `routes/auth.mjs` & `server.mjs` | `ERR_HTTP_HEADERS_SENT` crash on unauthenticated `GET /api/auth/session` | **Open (Documented; Fix Planned)** |
| **BDF-02** | **P2 (Medium)** | `components/AppShell.tsx` | Excessive sidebar vertical scroll when multiple pillars expanded | **Open (Documented; Fix Planned)** |
| **BDF-03** | **P2 (Medium)** | `apps/api/server.mjs` | Media Library files stored locally rather than in S3/R2 cloud bucket | **Open (Documented; Roadmap Phase 2)** |
| **BDF-04** | **P3 (Low)** | `pages/PublicFunnel.tsx` | Console warning on missing order bump placeholder image | **Open (Documented; Minor Polish)** |
