# S3 & Malware Scanning Configuration

- **S3 Bucket (`modules/storage`):** `operza-${var.environment}-uploads`, private (`block_public_acls = true`, `block_public_policy = true`, `ignore_public_acls = true`, `restrict_public_buckets = true`), versioning enabled, SSE-KMS (`aws:kms`), 7-day lifecycle expiration on `quarantine/`.
- **Tenant Path Convention:** `agencies/{agency_id}/locations/{location_id}/{resource}/{uuid}`.
- **Malware Scanning:** Staging ECS task definition enforces `CLAMAV_REQUIRED=true`. Files must remain quarantined and never be marked safe if ClamAV (`clamdscan`) is unavailable or returns non-zero.
- **Verification Limitation:** EICAR malware scan verification has **not** been executed locally (ClamAV binary absent on Windows host); must run against the ClamAV container in staging before pilot.
