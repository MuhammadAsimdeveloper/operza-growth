# Agency Audit Log

- Governance mutations (`agency.workspace.updated`, `agency.location.created/archived/restored`, `agency.member.offboarded`, `agency.invitation.created/revoked`, `agency.role.created`, `agency.session.revoked`) emit structured audit events.
- `AuditLog.tsx` (`/audit-log`) provides searchable, filterable agency audit history with CSV export.
