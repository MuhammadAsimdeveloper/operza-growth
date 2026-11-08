# Rule 03: Testing, Verification, and Quality Gates

## 1. Test-Driven Development (TDD) Lifecycle
All bug fixes and behavioral changes must strictly follow the **RED -> GREEN -> REFACTOR** discipline:
1. **RED:** Write a test that reproduces the defect or specifies the new behavioral contract. Execute the test and verify that it fails with the expected assertion failure.
2. **GREEN:** Write the minimal production code necessary to satisfy the test contract. Re-execute the test and verify that it passes.
3. **REFACTOR:** Clean up the implementation, improve readability, modularity, and performance, while keeping the test suite green.

## 2. Test Integrity Rules
- **Never modify or delete tests solely to make a broken build pass.** Tests define the specification. If a test fails, fix the code, or document an approved specification change before touching the test.
- **Never claim a test passed without running it.** Always execute the test command in the terminal and inspect the real output and exit code.
- Write tests that verify outcomes and contract boundaries, not internal private implementation details.
- Unit and integration tests must run quickly, hermetically, and predictably without relying on external third-party network access. Use local in-memory PostgreSQL (`@electric-sql/pglite`) or mock servers for network boundaries.

## 3. Evidence-Based Completion
Never claim a task is complete, fixed, or ready without concrete terminal evidence:
Every completion report or PR description must explicitly document:
1. **What changed:** Concrete files modified, added, or deleted.
2. **Why it changed:** Problem solved or feature implemented.
3. **Affected modules:** All downstream packages or callers touched.
4. **Exact tests executed:** Commands run, duration, and output summary.
5. **Actual results:** Pass/fail counts and terminal verification proof.
6. **Uncovered areas:** Explicitly list what was not tested and why.
7. **Security implications:** Tenant boundaries, input validation, and authorization impact.
8. **Known limitations:** Residual edge cases, technical debt, or follow-up items.
9. **Deployment safety:** Migration requirements, rollback considerations, and merge readiness.

*Banned phrases:* Never assert "enterprise-ready", "fully secure", "100% complete", or "production-tested" unless backed by reproducible test logs and verification artifacts.
