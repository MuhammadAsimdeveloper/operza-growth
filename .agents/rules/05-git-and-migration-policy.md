# Rule 05: Git Discipline and Migration Policy

## 1. Git Safety Guardrails
- **Never work directly on `main` or `master`.** All changes must be developed on short-lived, focused feature branches (e.g., `feat/<feature-name>`, `fix/<issue-name>`, `chore/<task>`).
- **Never force-push (`git push --force` or `-f`).** Force-pushing destroys team history and is strictly prohibited on all shared and upstream branches.
- **Never reset branches destructively (`git reset --hard`).** Do not delete or reset working trees.
- **Never stash or delete uncommitted user changes.** If a dirty worktree exists, preserve it, report the exact status, and operate without overwriting untracked or modified files.
- **Never delete remote branches without explicit authorization.**
- **Use Git Worktrees for Parallel Tasks:** When working on independent features or when running subagent tasks, use isolated Git worktrees (`git worktree add`) to prevent workspace corruption and merge collisions.

## 2. Pull Request & Commit Standards
- **Single Responsibility:** Each branch and pull request must address exactly one focused issue, feature, or refactoring slice.
- **Linear, Informative Commit Messages:** Use conventional commit formatting:
  - `feat(<scope>): <description>`
  - `fix(<scope>): <description>`
  - `refactor(<scope>): <description>`
  - `test(<scope>): <description>`
  - `docs(<scope>): <description>`
- **No Large Bulk Merges:** Never merge an entire foreign repository (like Atlas) into Operza in one monolithic pull request.
- Every PR must include:
  - Clear change summary.
  - Linked issue/spec.
  - Evidence of test execution and passing status.
  - Verification of no regressions in existing Operza features.

## 3. Migration Policy (Atlas -> Operza)
- **Selective & Staged Migration:** Migration from Atlas proceeds capability by capability according to an approved migration plan.
- **Preserve Operza Runtime:** Never disable an existing Operza feature before the migrated replacement is fully verified, tested, and feature-flagged.
- **Deprecation and Retirement:** Old modules are retired only after all consumers have migrated, verified through integration tests, and approved in review.
- **Maintain Rollback Capability:** Ensure each stage of migration has a clear rollback procedure.
