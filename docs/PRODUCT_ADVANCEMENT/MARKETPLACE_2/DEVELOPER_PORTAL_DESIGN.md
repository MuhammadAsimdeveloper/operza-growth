# Developer Portal Design

**Tables:** `marketplace_publishers`, `marketplace_app_releases`, `marketplace_analytics_events`  
**Routes:** `/api/developer/publishers`, `/api/developer/manifests/validate`, `/api/developer/apps`, `/api/developer/apps/:id/submit`, `/api/developer/publishers/:id/analytics`

## 1. Publisher Ownership Separation
Every publisher profile binds to `owner_user_id`. Draft creation, submission, new version publication, and analytics queries verify `publisher.owner_user_id === actor.userId`, preventing cross-publisher tampering or data leakage.
