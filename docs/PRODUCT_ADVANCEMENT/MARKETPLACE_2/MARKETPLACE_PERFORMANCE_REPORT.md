# Marketplace Performance Report

## 1. Indexing & Catalog Separation
- Public/catalog listing queries (`GET /api/marketplace/v2/catalog`) read directly from `marketplace_apps` without joining tenant-scoped `marketplace_installations`.
- `marketplace_publishers_owner_idx` on `(owner_user_id)` and `marketplace_analytics_app_idx` on `(app_id, event_type, created_at DESC)` support fast publisher portal and analytics queries.
