# Operza Engineering Environment Setup

This document specifies the local development environment, tooling requirements, repository structure, and configuration required to build, test, and contribute to **Operza Growth**.

---

## 1. System Requirements & Toolchain Baseline

### Verified Runtimes
| Tool | Minimum Required | Verified Local Version | Status | Notes |
|---|---|---|---|---|
| **Node.js** | `>= 20.0.0` | `v24.22.0` | **Verified** | Exceeds minimum; ES Modules native support active |
| **npm** | `>= 10.0.0` | `11.19.1` | **Verified** | Workspaces enabled (`apps/*`, `packages/*`) |
| **Git** | `>= 2.40.0` | `2.56.0.windows.2` | **Verified** | Windows Git with LF/CRLF normalization |
| **GitHub CLI (`gh`)** | `>= 2.40.0` | `2.103.0` (2026-10-21) | **Verified** | Supports native `gh skill` management |
| **Docker Engine** | Optional for dev | *Not in system PATH* | **Alternative Active** | PGlite used for hermetic in-memory DB tests |
| **PostgreSQL CLI (`psql`)** | Optional for dev | *Not in system PATH* | **Managed via npm** | Managed via `@operza/db` migration scripts |
| **Antigravity CLI (`agy`)** | Embedded Agent | Native Antigravity IDE | **Verified** | Native agent discovery scans `.agents/` |

---

## 2. Repository Architecture & Local Paths

### A. Canonical Repository: Operza Growth
- **Product Role:** The single source of truth, active application, and destination for all migrations.
- **Local Path:** `C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`
- **Remote Origin:** `https://github.com/MuhammadAsimdeveloper/operza-growth.git`
- **Active Branch:** `feat/operza-unified-atlas-automation`
- **Head Commit:** `f2595a1` (*fix(websites): resolve unclickable provision button, enable real hosting edge server...*)
- **Working Tree State:** Clean except for untracked/runtime telemetry data in `apps/api/data/store.json` (preserved intact).

### B. Reference Repository: Atlas
- **Product Role:** Architectural reference and donor repository for selective capability extraction.
- **Local Path:** `C:\Users\Muhammad Asim\Atlas`
- **Remote Origin:** `https://github.com/MuhammadAsimdeveloper/Atlas-.git`
- **Active Branch:** `feat/operza-crm-persistence-test-contract`
- **Head Commit:** `8556c13` (*merge: integrate GitHub branch updates*)
- **Working Tree State:** Clean.

---

## 3. Directory Layout & Monorepo Topology

```text
operza/
├── AGENTS.md                          # Primary agent operating system & instructions
├── GEMINI.md                          # Compact pointer configuration for Antigravity
│
├── .agents/
│   ├── rules/                         # Enforced workspace rules
│   │   ├── 00-product-direction.md
│   │   ├── 01-architecture-principles.md
│   │   ├── 02-domain-and-database.md
│   │   ├── 03-testing-and-verification.md
│   │   ├── 04-security-and-privacy.md
│   │   ├── 05-git-and-migration-policy.md
│   │   ├── 06-agent-coordination.md
│   │   └── 07-skill-usage.md
│   ├── skills/                        # 37+ project-scoped agent skills
│   └── agents/                        # 6 specialized agent team role profiles
│
├── apps/
│   ├── web/                           # React 19 / Vite frontend application
│   └── api/                           # Fastify / Node backend API and worker
│
├── packages/
│   ├── db/                            # PostgreSQL schema, migrations, and RLS
│   ├── platform-core/                 # Core domain models, accounts, and auth
│   ├── shared/                        # Shared TypeScript types and validators
│   └── workflow-engine/               # Visual builder graph compiler and runner
│
├── docs/
│   └── engineering/                   # Canonical engineering documentation & ADRs
│
└── scripts/                           # Dev scripts, SEO audits, and verification tools
```

---

## 4. Environment Variables Configuration

- An example configuration template is available at `.env.example`.
- **Security Rule:** Never check `.env` files into source control. Never print or log real API keys, database connection strings, or JWT secrets in console output or documentation.

---

## 5. Development & Testing Commands

All commands are executed from the Operza repository root:

| Command | Action | Scope |
|---|---|---|
| `npm run dev` | Starts full development stack | API + Web |
| `npm run dev:api` | Starts backend Fastify API server | `apps/api` |
| `npm run dev:web` | Starts Vite frontend dev server | `apps/web` |
| `npm run build` | Builds production frontend bundle | `apps/web` |
| `npm run typecheck` | Validates TypeScript types across web app | `apps/web` |
| `npm run test` | Executes full unit, platform, SEO, and e2e suites | Monorepo |
| `npm run test:unit` | Runs fast unit tests for workflow, platform, and db | Packages |
| `npm run test:platform` | Runs platform-core and db test suites | Packages |
| `npm run test:seo` | Runs automated SEO auditing scripts | `scripts/seo-audit` |
| `npm run test:e2e` | Runs end-to-end integration verification | `scripts/` |
| `npm run worker` | Runs background automation worker | `apps/api` |
