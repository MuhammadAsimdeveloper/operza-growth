# SLA & Support Metrics

- `sla_policies` (`051_unified_inbox_support_2_0.sql`) stores timezone, business hours (`enabled`, `startHour`, `endHour`, `days`), priority-based response/resolution targets, pause statuses (`waiting_on_customer`), and escalation thresholds.
- `computeSlaDeadlines` and `evaluateSlaStatus` (`unified-inbox-2-0.mjs`) calculate deadlines using `Intl.DateTimeFormat` in the policy's IANA timezone and distinguish `none`, `on_track`, `approaching`, `breached`, `paused`, and `completed`.
- `GET /api/support/v2/metrics` returns real persisted counts (`openCount`, `unassignedCount`, `overdueCount`, `resolvedCount`, `avgFirstResponseMs`, `avgResolutionMs`, `resolutionRate`, `slaComplianceRate`, `slaPolicyConfigured`, `smallSampleWarning`, `workloadByAgent`, `workloadByTeam`).
