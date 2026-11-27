# Sites 2.0 — Visual Editor Architecture

- **3-Pane Workspace (`SitesHub2Panel.tsx`):**
  - **Left:** Component Library (`hero`, `feature_grid`, `pricing`, `faq`, `cta`, `lead_form`, `booking_form`, `payment_link`).
  - **Center:** Responsive Canvas with Desktop (`100%`), Tablet (`768px`), and Mobile (`390px`) preview modes, section selection, and reordering.
  - **Right:** Property Inspector for live editing of section content.
  - **Top Toolbar:** Undo history, schema v2 validation (`/api/sites/v2/pages/validate`), and starter template installation.
- **Concurrency Safety:** `sites2Repo.savePageDraft` supports `expectedVersionLock` returning `409 VERSION_CONFLICT` on simultaneous edits.
