# RBAC & Permission Model

- `PERMISSION_CATALOG` (`agency-governance-2-0.mjs`) defines granular scopes across `agency`, `crm`, `support`, `marketing`, `workflows`, `commerce`, `ai`, and `analytics`.
- `BUILTIN_ROLE_TEMPLATES` provides 12 templates (`owner`, `admin`, `operations_manager`, `location_manager`, `sales_manager`, `sales_agent`, `support_manager`, `support_agent`, `marketing_manager`, `marketing_specialist`, `analyst`, `read_only`).
- `agency_roles` (`052`) supports custom roles with `validateCustomRolePermissions` blocking privilege escalation (`ESCALATION_DENIED`) and preventing location-scoped roles from granting agency-wide admin permissions (`SCOPE_ESCALATION_DENIED`).
