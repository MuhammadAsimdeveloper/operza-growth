## Contribution Track

Please select the track that applies to this pull request:

- [ ] **Bug Fix / Minor Patch** (non-test diff `<= 100` lines and `< 3` core files in `skills/`, `agents/`, or core packages; no design doc required).
- [ ] **Feature / Architectural Change — Stage 1: Design Doc PR** (requires an aligned issue with `design-ready`, uses `Refs #<issue>`, and adds `docs/designs/<name>.md` + updates `docs/designs/README.md`).
- [ ] **Feature / Architectural Change — Stage 2: Implementation PR** (requires an aligned issue with `pr-ready` and a merged `docs/designs/<name>.md`).

---

## Change Summary

Provide a concise summary of the changes made in this pull request and the rationale behind them.

- **What:**
- **Why:**

### Goals & Non-Goals
* **In-Scope Goals:**
  *
* **Out-of-Scope Non-Goals:**
  *

---

## Subsystems Impacted

- [ ] Visual Workflow Graph Canvas (`apps/web/src/components/WorkflowCanvas.tsx`)
- [ ] WYSIWYG Funnel & Page Builder (`apps/web/src/components/VisualPageBuilder.tsx`)
- [ ] Backend API & Routes (`apps/api/server.mjs`)
- [ ] BullMQ Redis Queue (`apps/api/queue.mjs`)
- [ ] Database Migrations & RLS Policies (`packages/db`)
- [ ] Workflow Execution Engine (`packages/workflow-engine`)
- [ ] Shared Domain Contracts (`packages/shared`)

---

## Verification & Testing

Every PR must pass automated CI checks. Check all that apply:

- [ ] `npm test` passed locally with 100% success (all 68 integration tests green).
- [ ] `npm run build` succeeded with 0 TypeScript compiler warnings or errors.
- [ ] Multi-tenant isolation verified (`agencyId` and `locationId` scoped across all queries).
- [ ] No regression in backward-compatible REST API endpoints.
- [ ] UI manual verification performed across desktop and mobile viewports.

---

## Author Accountability

- [ ] I confirm that this pull request adheres to the project's [Code of Conduct](CODE_OF_CONDUCT.md) and [Contributing Guidelines](CONTRIBUTING.md).
- [ ] I have not artificially split a cohesive feature or refactoring across multiple PRs to evade scope thresholds.
