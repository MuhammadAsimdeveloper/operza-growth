# Contributing to Operza

Thank you for your interest in contributing to **Operza**! Operza is an open-source, production-grade business automation platform and multi-tenant agency CRM designed to unify full-funnel client management, visual node-and-wire automation, and an autonomous AI Copilot.

We welcome contributions from developers, designers, and technical writers worldwide.

---

## Code of Conduct

All contributors and maintainers are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before participating.

---

## Getting Started

### Prerequisites
* **Node.js**: >= 20.0.0 (Node 22 LTS recommended)
* **npm**: >= 10.0.0
* **Docker & Docker Compose** (Optional, recommended for PostgreSQL RLS & Redis stack)
* **Git**

### 1. Clone the Repository
```bash
git clone https://github.com/MuhammadAsimdeveloper/operza-growth.git
cd operza-growth
```

### 2. Install Dependencies
Operza is organized as an npm workspace monorepo. Install all workspace dependencies from the root:
```bash
npm install
```

### 3. Configure Environment Variables
Copy the example environment file:
```bash
cp .env.example .env
```
> [!NOTE]
> By default, if PostgreSQL or Redis are not running, Operza automatically initializes in zero-config mode using local JSON persistence (`data/store.json`) and an in-memory queue. You can start developing immediately without installing external database servers!

### 4. Start Development Services
```bash
# Starts both Backend API (port 4000) and Web Client (port 5173) concurrently:
npm run dev
```

Visit [http://localhost:5173](http://localhost:5173) in your browser. The API health check is available at [http://localhost:4000/health](http://localhost:4000/health).

---

## Monorepo Architecture

Operza is divided into modular workspaces:

```
operza/
├── apps/
│   ├── api/                 # Express ESM REST API, WebSockets, Copilot SSE, & BullMQ Queue
│   └── web/                 # React 19 + TypeScript + Vite CRM UI (25+ view modules)
├── packages/
│   ├── db/                  # PostgreSQL Migrations & Row-Level Security (RLS) schemas
│   ├── workflow-engine/     # Workflow state machine, action dispatchers & approval gates
│   └── shared/              # Shared TypeScript domain contracts & DTO types
├── scripts/
│   ├── dev.mjs              # Local development launcher
│   └── test-e2e.mjs         # 68-step end-to-end integration test runner
└── docker-compose.yml       # Production-ready PostgreSQL 16 + Redis 7 + API + Web stack
```

---

## Development Workflow

### Branching Strategy
1. Create a descriptive branch from `master`:
   ```bash
   git checkout -b feat/custom-trigger-nodes
   # or
   git checkout -b fix/funnel-builder-responsive-preview
   ```
2. Keep branches focused on a single logical change or feature.

### Conventional Commits
We adhere to the [Conventional Commits](https://www.conventionalcommits.org/) specification:
* `feat:` A new feature or capability (e.g., `feat(workflows): add webhook wait trigger`)
* `fix:` A bug fix (e.g., `fix(canvas): prevent node overlap on auto-layout`)
* `docs:` Documentation changes (e.g., `docs: update quickstart guide`)
* `refactor:` Code changes that neither fix bugs nor add features
* `test:` Adding or updating tests (e.g., `test: add e2e test for payment checkout`)
* `chore:` Build process, dependency updates, or tool configurations

---

## Verification & Testing Standards

Before submitting any code for review, you must verify that all automated checks pass cleanly:

```bash
# 1. Typecheck & Build Web Client
npm run build

# 2. Run Complete End-to-End Test Suite (68 Integration Tests)
npm test
```

### Quality Checklist
- [ ] `npm test` runs with **100% passing tests** (68/68 passed, 0 failures).
- [ ] `npm run build` succeeds with **0 TypeScript compiler errors**.
- [ ] No hardcoded secrets, API tokens, or credentials committed.
- [ ] Multi-tenant isolation is respected (`agencyId` and `locationId` scoping on all queries).
- [ ] Backward compatibility maintained for existing REST routes.

---

## Submitting a Pull Request

1. Push your branch to your fork:
   ```bash
   git push origin feat/your-feature-name
   ```
2. Open a Pull Request targeting the `master` branch.
3. Fill out the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md) completely, detailing:
   - What changes were made and why.
   - Goals and Non-Goals.
   - Test results and verification screenshots if modifying the UI.
4. A maintainer will review your PR and provide feedback.

Thank you for helping make Operza the best open-source business OS!
