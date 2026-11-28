# Observability & Health Checks

- **Application Endpoints:**
  - `GET /health` (Liveness): Returns process uptime and WebSocket status (`200`).
  - `GET /ready` (Readiness): Verifies PostgreSQL + Redis dependency health (`200` when ready, `503` when degraded). ALB target group probes `/ready`.
  - `GET /metrics`: Public callers receive only runtime memory and DB engine; tenant entity counts require `OPERZA_ADMIN_KEY` or platform-admin session.
- **CloudWatch (`modules/observability`):**
  - Log groups: `/ecs/operza-${env}/api`, `/ecs/operza-${env}/worker`, `/ecs/operza-${env}/migrate` (`30` days retention staging, `90` days production).
  - RDS PostgreSQL exports `postgresql` and `upgrade` logs to CloudWatch.
  - CloudWatch Metric Alarm: `operza-${env}-api-high-cpu` (`CPUUtilization > 80%` over 2×5m periods).
- **Status:** Defined in Terraform only; CloudWatch monitoring is not active until deployed.
