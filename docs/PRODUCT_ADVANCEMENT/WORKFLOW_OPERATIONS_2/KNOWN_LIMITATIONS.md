# Known Limitations & External Dependencies — Stage 14

1. **Local Environment vs. Distributed Worker Cluster**: Redis/BullMQ and a multi-node distributed worker cluster are not provisioned in the local verification environment. Control-plane logic (`FOR UPDATE SKIP LOCKED`, leases, heartbeats, recovery) is verified locally against isolated PostgreSQL (`operza_app` with `FORCE RLS`), not a live multi-worker staging cluster.
2. **Cooperative Cancellation Latency**: While queued/waiting runs cancel immediately, active `running` / `resuming` executions record `cancel_requested_at` and depend on the executing worker checking cancellation state between steps; external HTTP/provider calls already in flight cannot be rolled back by Operza.
3. **Live Provider Sandboxes**: External email/SMS/WhatsApp/Stripe provider round-trips remain gated behind live sandbox credentials (`LIVE_PROVIDER_TESTS=true`).
