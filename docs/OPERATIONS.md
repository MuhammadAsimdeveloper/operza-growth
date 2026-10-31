# Operza Operations, SRE & Observability Runbook

## 1. Observability Endpoints

The Operza Unified API exposes native health, readiness, and metrics endpoints:

| Endpoint | Purpose | SLA / Threshold |
| :--- | :--- | :--- |
| `GET /health` | Deep system health inspecting database ping, Redis connectivity, memory RSS, and active queues. | Returns 200 OK with `status: "healthy"` in <10ms. |
| `GET /ready` | Kubernetes / Docker Compose readiness probe verifying database schema readiness. | Returns 200 OK when migrations are applied. |
| `GET /metrics` | Real-time Prometheus compatible process metrics, memory heaps, and queue depths. | Formatted for Prometheus / Datadog scraping. |
| `GET /api/admin/queue/status` | Queue inspector reporting active, waiting, completed, and dead-lettered jobs. | Visible in Admin console. |

---

## 2. Common Operations Playbooks

### Playbook 1: PostgreSQL Connection Pool Exhaustion
- **Symptom:** API logs report `timeout exceeded when connecting to database` or `/health` shows `database: { status: "degraded" }`.
- **Diagnosis:** Inspect active connections in PostgreSQL:
  ```sql
  SELECT count(*), state FROM pg_stat_activity WHERE datname = 'operza_db' GROUP BY state;
  ```
- **Remediation:** Verify that transactions are releasing connections in `finally` blocks. Ensure API connection pool maximum matches host RAM limits (`max: 20` per container instance).

### Playbook 2: Redis Worker Queue Backlog
- **Symptom:** Workflow steps or email notifications experience lag (>60s latency).
- **Diagnosis:** Query queue status:
  ```bash
  curl -s http://localhost:4000/api/admin/queue/status | jq .
  ```
- **Remediation:** Scale the worker process or launch a secondary worker instance:
  ```bash
  docker compose -f docker-compose.prod.yml up -d --scale worker=2
  ```

### Playbook 3: Emergency Secret Rotation
If `SESSION_SECRET` or `JWT_SECRET` is compromised:
1. Generate new 64-character hex secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Update `.env` with the new value.
3. Restart API and Worker services:
   ```bash
   docker compose -f docker-compose.prod.yml restart api worker
   ```
*(Note: Existing sessions will be invalidated, prompting users to re-authenticate cleanly).*
