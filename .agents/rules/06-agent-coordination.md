# Rule 06: Agent Team Coordination and Role Boundaries

## 1. Multi-Agent Team Structure
AI development operates as a coordinated engineering team with explicit separation of concerns:

| Role | Primary Ownership | Authority & Boundary |
|---|---|---|
| **Principal Architect** | System design, monorepo boundaries, convergence strategy, ADR approval | Owns overall technical roadmap; approves interfaces; rejects duplicate systems |
| **Backend & Database Engineer** | Fastify/Express API, PostgreSQL schema, RLS policies, migrations, data models | Owns server-side logic and database safety; enforces tenant isolation |
| **Workflow & Automation Engineer** | Workflow graph compiler, node registry, durable state machine, worker queue | Owns automation reliability, idempotency, retry policies, and execution state |
| **AI & Integration Engineer** | Copilot runtime, agent tools, LLM providers, external SaaS adapters | Owns tool safety, provider verification, rate limiting, and prompt grounding |
| **Frontend Engineer** | React 19 / Vite web client, component composition, state management, UX | Preserves existing UI surfaces; optimizes render performance; runs browser QA |
| **QA & Security Reviewer** | Regression testing, security audits, tenant boundary verification, gatekeeper | Independent critic; verifies claims with real test runs; gates merge approval |

## 2. Coordination and Collaboration Protocols
1. **Single Task Ownership:** Every task, issue, or refactor must have one clear owning agent role.
2. **Clear Acceptance Contracts:** Tasks handed off between agents must have explicit input/output contracts, preconditions, and measurable acceptance criteria.
3. **Write Isolation & Worktrees:** Parallel agents must work in isolated Git worktrees. Never allow two agents to concurrently edit overlapping files in the same worktree.
4. **Independent Review Requirement:**
   - An agent that implements code **cannot** conduct its own security or QA approval.
   - The Independent QA and Security Reviewer must independently inspect the diff, run the test suite, and challenge all assertions.
5. **Architectural Integration:** The Principal Architect integrates verified contributions and ensures adherence to the master convergence roadmap.
6. **No Phantom Progress:** Agents must report exact terminal command outputs, exit codes, and diffs rather than stating that work is "done" without verification.
