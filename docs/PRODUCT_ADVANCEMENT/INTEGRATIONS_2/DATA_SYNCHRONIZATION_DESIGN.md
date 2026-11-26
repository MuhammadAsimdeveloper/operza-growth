# Data Synchronization Design 2.0

**Module:** `packages/platform-core/src/sync-engine-v2.mjs`  
**Tables:** `integration_sync_jobs`, `integration_sync_conflicts` (`042_integrations_2_0.sql`)

## 1. Loop Prevention & Conflict Resolution
- **Loop Prevention:** `shouldSkipForSyncLoop` rejects events originating from `operza` (`originSystem === currentSystem`) or already-processed `originEventId`s.
- **Conflict Policies:**
  - `source_priority`: Operza CRM wins on tie.
  - `timestamp_wins`: Newer `updatedAt` wins; equal timestamps queue into `integration_sync_conflicts`.
  - `manual_queue`: Always queues ambiguous updates into `integration_sync_conflicts` for human resolution without silent data overwrite.
- **Scale Note:** Large background sync jobs require the Redis/worker queue infrastructure; local synchronous fallbacks are not claimed as production-scale batch sync.
