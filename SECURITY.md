# Security Policy

The Operza team and community take the security of our platform, multi-tenant boundaries, and user data extremely seriously. We appreciate your efforts to responsibly disclose vulnerabilities to us.

---

## Supported Versions

Only the current major version and recent minor releases receive security patches.

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

---

## Reporting a Vulnerability

**Please DO NOT report security vulnerabilities through public GitHub issues or discussions.**

Instead, please report security issues through one of the following methods:

1. **GitHub Private Security Advisory:** Submit a confidential advisory via [GitHub Security Advisories](https://github.com/MuhammadAsimdeveloper/operza-growth/security/advisories/new).
2. **Email Disclosure:** Send an email to **security@operza.io** (or operza-security@proton.me).

### What to Include in Your Report

To help us triage and resolve your report quickly, please include:
- A detailed description of the vulnerability.
- Steps to reproduce the issue (including proof-of-concept scripts or HTTP request payloads).
- The affected component (`apps/api`, `apps/web`, `packages/db`, `packages/workflow-engine`, etc.).
- An assessment of the potential impact (e.g., cross-tenant data leakage, privilege escalation, remote code execution).
- Any proposed remediations or patches.

---

## Our Security Commitments

When a vulnerability is reported:
1. **Initial Acknowledgment:** We will acknowledge receipt of your report within **24 hours**.
2. **Triage & Validation:** We will assess and validate the vulnerability within **48 hours**.
3. **Fix & Release:** We will develop, test, and release a patched version with high priority, typically within **7 business days** depending on severity.
4. **Coordinated Disclosure:** We adhere to responsible coordinated disclosure. We will credit you in the release notes and advisory once the patch is published.

---

## Multi-Tenant Security Model

Operza operates under a defense-in-depth security model:
* **Database Layer:** Multi-tenancy is enforced through PostgreSQL Row-Level Security (RLS) with session variables (`SET LOCAL app.current_agency_id`). Application queries run as an unprivileged database role (`operza_app`).
* **API Layer:** All state-modifying requests require valid tenant context (`X-Location-ID`, `X-Agency-ID`), CSRF tokens (`X-CSRF-Token`), and session authentication cookies.
* **Workflow Engine:** Dynamic JavaScript expressions and external actions run in sandboxed execution scopes with configurable memory and execution timeouts.
