# Node Registry Specification — Workflow Builder 2.0

**Module:** `packages/workflow-engine/src/node-registry-v2.mjs`  
**Endpoint:** `GET /api/workflows/v2/registry?category=&search=`

## 1. Node Definition Contract
Every node in `NODE_REGISTRY_V2` specifies:
- `type`: Unique identifier (e.g., `contact_created`, `approval_gate`, `ai_classify`)
- `displayName`, `description`, `category`, `version`
- `inputSchema`, `outputSchema`, `configSchema`
- `requiredPermissions`, `riskLevel` (`low` | `medium` | `high`)
- `timeoutMs`, `retryPolicy` (`maxAttempts`, `backoff`, `baseDelayMs`)
- `idempotencyBehavior`, `credentialRequirements`, `uiMetadata`

## 2. Categories Covered
- **Triggers (`triggers`):** `manual`, `webhook`, `schedule`, `contact_created`, `contact_updated`, `contact_tag_changed`, `opportunity_created`, `opportunity_stage`, `form`, `appointment`, `payment`, `conversation_event`, `integration_event`
- **CRM 2.0 (`crm`):** `create_contact`, `update_contact`, `find_contact`, `tag`, `remove_tag`, `lifecycle_stage`, `assign_to`, `create_opportunity`, `opportunity_stage`, `task`, `create_note`
- **Communication (`communication`):** `email`, `sms`, `whatsapp`, `create_conversation`, `internal_notification`, `webhook_outbound`, `zapier`
- **Logic & Control Flow (`logic`):** `condition`, `switch`, `and_or_condition`, `wait`, `schedule_delay`, `loop_items`, `split_branches`, `merge`, `stop`, `approval_gate`, `sub_workflow`, `webhook_respond`, `wait_webhook`
- **Data Operations (`data`):** `set_variable`, `map_fields`, `format_data`, `validate_data`, `convert_types`, `parse_json`, `date_time`, `string_transform`, `filter_array` (zero arbitrary JS/SQL)
- **Commerce (`commerce`):** `create_payment_link`, `find_invoice`, `check_payment_status`, `apply_coupon`, `create_order`
- **AI Operations (`ai`):** `ai_generate`, `ai_classify`, `ai_summarize`, `ai_extract`, `ai_decision`, `ai_kb_retrieve`, `ai_agent`
