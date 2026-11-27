# Resilience & Failure Testing

- Outbox event deduplication prevents duplicate processing for identical `(agencyId, locationId, eventType, entityId, sourceEventId)`.
- Workflow loop guard rejects `loopDepth > 3` (`WORKFLOW_LOOP_PREVENTED`).
- Optimistic concurrency (`expectedVersion`) prevents conflicting assignment/lifecycle updates.
- Unavailable AI providers return `aiAvailable: false` cleanly without fabricating responses.
