# Rule 00: Product Direction and Identity

## 1. Canonical Product
- **Operza (`operza-growth`)** is the **only** final product, application codebase, and single source of truth.
- **Atlas (`Atlas-`)** is strictly an **architectural reference and migration source** of selected, better-engineered capabilities.
- Atlas will **never** be launched as a separate product.

## 2. Convergence Laws (Permanent Decisions)
1. **Operza is the only product.** No competing or parallel application may be deployed or developed.
2. **Atlas capabilities will be selectively migrated.** Only well-engineered, robust modules (e.g., action fabric, typed registries, durable execution primitives, PGlite test patterns) are brought into Operza.
3. **Operza's React frontend and valuable product modules must be preserved.** Do not casually redesign or throw away existing Operza user interfaces.
4. **Better Atlas implementations replace weaker Operza implementations.** Where Atlas has superior engineering (e.g., typed action schemas vs. ad-hoc JSON), the Atlas pattern replaces the weaker Operza pattern.
5. **No duplicate systems survive convergence.** Duplicate modules, databases, business entities, workflow engines, background queues, and authorization models must be eliminated.
6. **Atlas must not become a second application inside Operza.** There is one unified application architecture.
7. **Single Canonical Architecture:** Operza must have one canonical database, one identity system, one workflow engine, one AI runtime, and one unified deployment topology.

## 3. Canonical Domain Identity: Agency and Location
- The canonical business identity is **Operza's agency/location hierarchy** (`tenant_id` / `agency_id` and `location_id`).
- **Never** introduce a second Atlas organization/tenant system. All migrated capabilities must bind to Operza's agency/location model.

## 4. Product Scope and Prioritization
The long-term Operza platform combines:
- CRM and customer lifecycle management.
- Business growth and marketing engines.
- Visual workflow automation and durable execution.
- AI Copilot and autonomous AI agents.
- Business integrations and provider adapters.
- Unified inbox and customer operations.
- Appointments, scheduling, and booking.
- Reporting, telemetry, and analytics.
- Agency administration and customer portals.
- Commercial features, billing, and usage management.

**Initial Business Priority:** Delivering reliable, observable, production-grade AI automation services through Operza. Do not build features simply to inflate module counts.
