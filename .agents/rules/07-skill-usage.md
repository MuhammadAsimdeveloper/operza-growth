# Rule 07: Skill Usage and Adoption Protocol

## 1. Skills Are Operational Disciplines, Not Merely Files
- **Installing a skill is not completion.** A skill represents an engineering standard, a structured methodology, and a concrete procedure.
- Whenever a task triggers a specific activity, the agent **must explicitly consult, reference, and follow** the corresponding skill's instructions.
- Do not claim a skill was used unless its actual procedure, steps, and deliverables are evident in the work.

## 2. Activity-to-Skill Routing Table

| Engineering / Business Activity | Required Skill | Expected Workflow & Deliverable |
|---|---|---|
| **Architecture & Component Inception** | `brainstorming` (Superpowers) | Interactive exploration, alternatives considered, design doc written before implementation |
| **Domain Terminology & Entities** | `domain-modeling` (Matt Pocock) | Define entities, boundaries, ubiquitous language, and update GLOSSARY/ADR |
| **Module Seam & API Contract Design** | `codebase-design` (Matt Pocock) & `api-and-interface-design` (Addy Osmani) | Deep modules, typed request/response schemas, zero leaking internals |
| **Architectural Evaluation & Smells** | `improve-codebase-architecture` (Matt Pocock) | Scan for shallow modules, report friction points, propose deepening refactors |
| **Task Decomposition & Roadmapping** | `writing-plans` (Superpowers) & `planning-and-task-breakdown` (Addy) | Step-by-step actionable plan with files, commands, and bite-sized tasks |
| **New Features & Bug Fixes** | `test-driven-development` (Superpowers) | Red -> Green -> Refactor; write failing test before modifying implementation |
| **Difficult Defects & Flaky Tests** | `systematic-debugging` (Superpowers) | Root cause tracing, hypothesis testing, isolation scripts, defense-in-depth |
| **Legacy Code Removal / System Cutover** | `deprecation-and-migration` (Addy Osmani) | Expand-and-contract pattern, backwards compatibility, migration checklist |
| **React Component Development** | `vercel-react-best-practices` & `vercel-composition-patterns` (Vercel) | Eliminate waterfalls, avoid boolean prop soup, leverage compound components |
| **Browser Verification & Client QA** | `browser-testing-with-devtools` (Addy Osmani) | Real browser verification, console log inspection, network HAR audit |
| **Security Auditing & Hardening** | `security-audit` (Cloudflare) & `security-and-hardening` (Addy) | OWASP top 10 review, sandboxed reconnaissance, tenant isolation audit |
| **Pull Request Code Review** | `requesting-code-review` & `receiving-code-review` (Superpowers) | Standards and spec review, technical verification, no performative agreement |
| **Worktree Isolation for Tasks** | `using-git-worktrees` (Superpowers) | Safe branch isolation via worktree before executing multi-step tasks |
| **Task & Subagent Orchestration** | `subagent-driven-development` & `dispatching-parallel-agents` (Superpowers) | Focused worker agents with clear acceptance criteria and reviewer checks |
| **Completion Verification** | `verification-before-completion` (Superpowers) | Run test suite, verify clean exit code, confirm output before making claims |
| **Instruction & Architecture Docs** | `writing-for-agents` (Matt Pocock) & `documentation-and-adrs` (Addy) | Precise context pointers, unambiguous instructions, recorded ADRs |
| **Customer Research & JTBD** | `customer-research` (Corey Haines) | Voice of customer analysis, pain-point mining, interview synthesis |
| **Product Marketing & Positioning** | `product-marketing` (Corey Haines) | Target audience, ICP definition, value propositions, positioning context |
| **Competitive Comparison Pages** | `competitors` (Corey Haines) | Alternative pages, comparison tables, defensible differentiators |
| **Conversion Rate Optimization** | `cro` (Corey Haines) | Form friction reduction, value framing, copy hierarchy, CTA placement |
| **Packaging & Pricing Strategy** | `pricing` (Corey Haines) | Tier structures, value metrics, self-serve vs. sales-assisted packaging |
| **Revenue Operations & Pipelines** | `revops` (Corey Haines) | Lead lifecycle stages, CRM pipeline hygiene, automated status transitions |
| **Sales Enablement Collateral** | `sales-enablement` (Corey Haines) | Battlecards, objection handling libraries, demo scripts, pitch decks |
| **Outbound Email Sequences** | `cold-email` (Corey Haines) | Deliverability checks, personalization frameworks, reply-handling rules |
| **Feature Release & Launch GTM** | `launch` (Corey Haines) | Pre-launch QA checklist, changelog, launch announcement strategy |

## 3. Skill Execution Verification
Before declaring any task complete, verify that:
1. The appropriate skill was selected based on the routing table.
2. The skill's methodology was explicitly followed.
3. The deliverable matches the skill's defined quality standard.
