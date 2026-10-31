# Operza Automated Testing, QA & Verification Guide

## 1. Test Suite Architecture

Operza enforces a comprehensive 4-tier automated test pyramid covering units, schemas, security policies, concurrency, and real-world system journeys:

```
                  ┌───────────────────────────────┐
                  │    Load & Performance (k6)    │
                  │   10, 25, 50, 100 VUs Stress  │
                  └──────────────┬────────────────┘
                                 │
                  ┌──────────────┴────────────────┐
                  │  End-to-End System & Security │
                  │     93 Multi-Tenant Tests     │
                  └──────────────┬────────────────┘
                                 │
                  ┌──────────────┴────────────────┐
                  │   Technical SEO & Metadata    │
                  │    106 Automated Checks       │
                  └──────────────┬────────────────┘
                                 │
                  ┌──────────────┴────────────────┐
                  │   Workflow Engine Unit Suite  │
                  │    12 State Machine Tests     │
                  └───────────────────────────────┘
```

---

## 2. Executing Automated Tests

### A. Master Test Suite (211 Automated Checks)
```bash
npm test
```
Executes:
1. `@operza/workflow-engine` Unit Suite (12/12 passed).
2. Enterprise Technical SEO, Open Graph & Structured Data Suite (106/106 passed).
3. End-to-End System, Security, Concurrency & Tenant Isolation Suite (93/93 passed).

### B. TypeScript Static Typecheck
```bash
npm run typecheck
```
Executes `tsc -b --noEmit` across all workspace packages and frontend React applications.

### C. Production Bundle Build Verification
```bash
npm run build
```
Executes Vite production bundle compilation, verifying asset bundling, chunk generation, and minification in <3 seconds.

### D. Realistic Agency Concurrency Load Test (k6)
```bash
k6 run scripts/load-test/k6-realistic-agency-workload.js
```
Simulates realistic production traffic across 10, 25, 50, and 100 concurrent virtual users measuring p50, p95, and p99 response latencies.
