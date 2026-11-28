# S3 & ClamAV Readiness

- **S3 Storage (`infra/terraform/modules/storage/main.tf`):** Private bucket (`block_public_acls`, `block_public_policy`, `ignore_public_acls`, `restrict_public_buckets = true`), versioning enabled, SSE-KMS (`aws:kms`), 7-day `quarantine/` expiration lifecycle.
- **ClamAV Configuration:** ECS API task & `docker-compose.staging.yml` enforce `CLAMAV_REQUIRED=true`.
- **Local Verification Status:** `clamdscan` is **MISSING** on this Windows host and no S3 bucket was provisioned. EICAR malware scan verification must be executed in the actual staging ClamAV environment before enabling user uploads.
