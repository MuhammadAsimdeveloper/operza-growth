# Integration 2.0 Performance & Reliability Report

## 1. Indexing & Deduplication
- `integration_connections_connector_idx` on `(agency_id, location_id, connector_id, status)`
- `integration_webhook_events_state_idx` on `(agency_id, location_id, processing_state, received_at DESC)`
- `UNIQUE (agency_id, location_id, provider, provider_event_id)` on `integration_webhook_events` prevents duplicate webhook ingestion at the database constraint layer.

## 2. Bounded Reliability Policies
- Per-connector rate limits (`60 req / 60s` default), `10,000 ms` request timeouts (`AbortSignal.timeout`), exponential backoff retry classification, and per-connection circuit breakers (`5` consecutive failures -> `60s` open window).
