# OPERZA — NEXT-PHASE IMPLEMENTATION & STAGING LAUNCH MASTER PROMPT

## 1. MISSION & CONTEXT

You are acting as a Principal SaaS Software Architect, Senior Full-Stack Engineer, Application Security Specialist, and DevOps Engineer.

You are continuing the implementation and launch readiness work on the **Operza** multi-tenant SaaS platform:
- **Repository:** [`MuhammadAsimdeveloper/operza-growth`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza)
- **Active Working Branch:** `repair/production-hardening`
- **Synchronized Production Branch:** `release/production-launch`
- **Audit Baseline:** [`OPERZA_COMPLETE_AUDIT_REPORT.md`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/OPERZA_COMPLETE_AUDIT_REPORT.md)
- **Test Suite Status:** 211 / 211 Automated Tests Passed (100%)
- **Current Verdict:** **READY FOR STAGING**

---

## 2. STRICT FINANCIAL & SAFETY RULES (NON-NEGOTIABLE)

1. **ZERO-COST AWS POLICY:** We have $100 in AWS credits that must be protected. Do not run any commands that launch EC2 instances, provision RDS databases, create S3 buckets, or incur charges. All pre-launch verification must occur locally or within free Docker containers.
2. **NO AUTONOMOUS PULL REQUESTS:** In accordance with repository guidelines ([`AGENTS.md`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/.github/PULL_REQUEST_TEMPLATE.md)), never automatically open a PR without explicit human review and approval.
3. **CLICKABLE MARKDOWN LINKS:** Always format file and symbol references as clickable links with `file:///` format and forward slashes.

---

## 3. PRIORITIZED WORK PACKAGES FOR THE NEXT IMPLEMENTATION CYCLE

### Work Package 1: Staging Environment Preparation & Docker Hardening
- **Objective:** Ensure single-command local and remote staging deployment using [`docker-compose.prod.yml`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/docker-compose.prod.yml).
- **Tasks:**
  1. Audit Nginx configuration in [`apps/web/Dockerfile`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/Dockerfile) to ensure gzip/brotli compression, security headers (`Content-Security-Policy`, `X-Frame-Options: SAMEORIGIN`), and SPA routing fallbacks (`try_files $uri $uri/ /index.html`).
  2. Implement a local staging launch verification script (`scripts/verify-staging.mjs`) that spins up the production containers, validates health checks (`/health`, `/ready`), seeds demo tenant data, and tears down gracefully.
  3. Validate resource constraints (CPU caps and memory ceilings) on Postgres (`1GB`), Redis (`256MB`), and API (`512MB`) containers under simulated traffic.

### Work Package 2: Real Provider Swap-in & Credential Validation
- **Objective:** Provide zero-downtime, safe switching from local mocks to live third-party providers.
- **Tasks:**
  1. Enhance [`apps/api/providers/email.mjs`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/api/providers/email.mjs) with an active connection probe (`verifyConnection()`) for Amazon SES / SMTP credentials on startup.
  2. Verify Twilio SMS provider in [`apps/api/providers/sms.mjs`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/api/providers/sms.mjs) to handle 10DLC registration compliance metadata and outbound status webhooks.
  3. Ensure Stripe Payment Provider in [`apps/api/providers/payments.mjs`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/api/providers/payments.mjs) supports both test mode (`sk_test_...`) and production mode (`sk_live_...`) with automated signature verification.

### Work Package 3: UI & Visual Builder Polish
- **Objective:** Enhance the user experience in the visual canvas and CRM contact management.
- **Tasks:**
  1. Add full drag-to-connect node handles in [`apps/web/src/pages/Workflows.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/Workflows.tsx) so users can wire workflow nodes interactively.
  2. Enhance the Contact Duplicate Merge modal in [`apps/web/src/pages/Contacts.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/Contacts.tsx) with a field-by-field diff viewer allowing the operator to select which phone number, email, or company name to retain when merging.
  3. Implement keyboard navigation shortcuts (`Ctrl+S` to save, `Delete` to remove step) in the workflow canvas.

### Work Package 4: Database Standby & Backup Automation
- **Objective:** Protect tenant data with verified, automated disaster recovery procedures.
- **Tasks:**
  1. Test automated snapshot backups with [`scripts/backup.mjs`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/scripts/backup.mjs) and verify cryptographic restore using [`scripts/restore.mjs`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/scripts/restore.mjs).
  2. Document the PostgreSQL standby streaming replication setup for high availability in AWS Mumbai (`ap-south-1`).

---

## 4. VERIFICATION GATES

Before marking any task complete in this phase, execute and confirm:
1. `npm run typecheck` (`tsc -b --noEmit`) passes with 0 errors.
2. `npm run build` generates production assets without bundle errors.
3. `npm test` runs all 211 tests (engine unit tests + SEO audit checks + system e2e tests) and passes with 100% success rate.
4. Check Git status and synchronize both `repair/production-hardening` and `release/production-launch` branches.
