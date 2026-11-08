# Operza Engineering Operating System & Agent Instructions

Welcome to the **Operza** engineering environment. This repository houses **Operza Growth**, the unified open-source business operating system, agency CRM, and intelligent automation engine.

All agents operating in this repository must operate as a disciplined, professional engineering team. You are not a loose code generator; you are an engineering system that designs, tests, implements, reviews, and independently verifies all work.

---

## 1. Core Operating Principles

1. **Operza is the Single Canonical Product:**
   - Operza (`MuhammadAsimdeveloper/operza-growth`) is the only product, application codebase, and source of truth.
   - Atlas (`MuhammadAsimdeveloper/Atlas-`) is an architectural reference and migration source of selected capabilities. Atlas will never be launched as a standalone application.
   - No duplicate modules, databases, tenant systems, or engines survive convergence.
   - Operza's agency/location hierarchy is the single canonical tenant model.

2. **Architecture Before Code:**
   - Never write production code without an approved plan and explicit contracts.
   - For non-trivial tasks, run the `brainstorming` and `writing-plans` skills before touching source files.

3. **Test-Driven Development (TDD):**
   - Every behavioral modification or bug fix follows **RED -> GREEN -> REFACTOR**.
   - A failing test proving the requirement or bug must run and fail before the solution is written.
   - Never report a test as passing without executing it in the terminal and verifying the output.

4. **Security, Privacy, and Sandboxing:**
   - Strict tenant isolation across all endpoints and background jobs using PostgreSQL RLS.
   - Zero hardcoded secrets, no secret leakage in logs, and mandatory SSRF protection on outbound requests.
   - AI tools operate with strictly bounded capabilities and human approval gates for high-risk actions.

5. **Git Discipline:**
   - Never push directly to `main` or `master`.
   - Never force-push or reset branches destructively.
   - Never overwrite or discard uncommitted user changes.
   - Use Git worktrees for parallel agent tasks.

---

## 2. Workspace Rules Index

Detailed, binding engineering rules are located in `.agents/rules/`. Every agent must comply with these rules:

- [Rule 00: Product Direction and Identity](.agents/rules/00-product-direction.md)
- [Rule 01: Architecture Principles and Code Quality](.agents/rules/01-architecture-principles.md)
- [Rule 02: Domain Model and Database Safety](.agents/rules/02-domain-and-database.md)
- [Rule 03: Testing, Verification, and Quality Gates](.agents/rules/03-testing-and-verification.md)
- [Rule 04: Security, Privacy, and Execution Boundaries](.agents/rules/04-security-and-privacy.md)
- [Rule 05: Git Discipline and Migration Policy](.agents/rules/05-git-and-migration-policy.md)
- [Rule 06: Agent Team Coordination and Role Boundaries](.agents/rules/06-agent-coordination.md)
- [Rule 07: Skill Usage and Adoption Protocol](.agents/rules/07-skill-usage.md)

---

## 3. Skill Adoption and Execution

Skills are located in `.agents/skills/`. When performing specific engineering or business activities, agents must invoke and adhere to the designated skill:

- **Planning & Architecture:** `brainstorming`, `writing-plans`, `domain-modeling`, `codebase-design`, `improve-codebase-architecture`
- **Implementation & Debugging:** `test-driven-development`, `systematic-debugging`, `deprecation-and-migration`
- **Frontend & UX:** `vercel-react-best-practices`, `vercel-composition-patterns`, `browser-testing-with-devtools`
- **Security & Quality:** `security-audit`, `security-and-hardening`, `requesting-code-review`, `verification-before-completion`
- **Commercial & Operations:** `customer-research`, `product-marketing`, `competitors`, `cro`, `pricing`, `revops`, `sales-enablement`, `cold-email`, `launch`

Refer to [docs/engineering/SKILL_ADOPTION_MAP.md](docs/engineering/SKILL_ADOPTION_MAP.md) for the exhaustive operational routing matrix.

---

## 4. Multi-Agent Team Roles

When delegating or dividing tasks, adhere to the team profile contracts in `.agents/agents/` and [docs/engineering/AGENT_TEAM.md](docs/engineering/AGENT_TEAM.md):
- **Principal Architect:** System design, monorepo boundaries, ADR ownership.
- **Backend & Database Engineer:** API contracts, PostgreSQL schemas, RLS policies.
- **Workflow & Automation Engineer:** State machines, node registry, durable queues.
- **AI & Integration Engineer:** Copilot runtime, tool registry, external adapters.
- **Frontend Engineer:** React 19/Vite interfaces, responsive design, bundle performance.
- **QA & Security Reviewer:** Independent verification, test execution, security audits.
