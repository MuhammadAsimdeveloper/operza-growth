/**
 * ============================================================================
 * Operza Data Synchronization Engine 2.0
 * ============================================================================
 * Loop-safe one-way & two-way synchronization with source tracking, field
 * mapping, and explicit conflict resolution policies.
 */

export function mapRecordFields(record = {}, fieldMappings = {}) {
  const mapped = {};
  for (const [targetKey, sourceKey] of Object.entries(fieldMappings)) {
    if (record[sourceKey] !== undefined) {
      mapped[targetKey] = record[sourceKey];
    }
  }
  return mapped;
}

export function shouldSkipForSyncLoop({ originSystem, currentSystem = 'operza', originEventId, seenOriginEvents }) {
  if (originSystem && originSystem === currentSystem) {
    return { skip: true, reason: 'LOOP_ORIGIN_SELF' };
  }
  if (originEventId && seenOriginEvents?.has(originEventId)) {
    return { skip: true, reason: 'LOOP_EVENT_ALREADY_PROCESSED' };
  }
  return { skip: false };
}

export function resolveSyncConflict({
  conflictPolicy = 'source_priority',
  localRecord = {},
  externalRecord = {},
  direction = 'two_way'
}) {
  if (direction === 'one_way_inbound') {
    return { resolution: 'external_wins', merged: { ...localRecord, ...externalRecord } };
  }
  if (direction === 'one_way_outbound') {
    return { resolution: 'local_wins', merged: { ...externalRecord, ...localRecord } };
  }
  if (conflictPolicy === 'manual_queue') {
    return { resolution: 'conflict_queued', merged: null };
  }
  if (conflictPolicy === 'timestamp_wins') {
    const localTs = Date.parse(localRecord.updatedAt || 0) || 0;
    const extTs = Date.parse(externalRecord.updatedAt || 0) || 0;
    if (extTs > localTs) {
      return { resolution: 'external_wins', merged: { ...localRecord, ...externalRecord } };
    }
    if (localTs > extTs) {
      return { resolution: 'local_wins', merged: { ...externalRecord, ...localRecord } };
    }
    return { resolution: 'conflict_queued', merged: null };
  }
  // source_priority: Operza CRM wins on tie
  return { resolution: 'local_wins', merged: { ...externalRecord, ...localRecord } };
}
