# Known Limitations — Stage 16

1. **External Providers**: Live SMS, Email, WhatsApp, Stripe, and LLM provider round-trips remain disabled/gated (`LIVE_PROVIDER_TESTS=true` / `OPERZA_LIVE_MESSAGING=true` not enabled locally).
2. **Distributed Infrastructure**: Multi-node Redis/BullMQ worker clusters, AWS ECS/RDS, and public DNS/ACME are not provisioned in local verification.
3. **Pre-existing Staging Dependencies**: Full staging verification requires AWS deployment and live provider sandbox credentials.
