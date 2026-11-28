# AWS Staging Architecture

- **Frontend (`apps/web` & `apps/marketing`):** Separate private S3 buckets fronted by CloudFront (Origin Access Control + HTTPS redirect). Static delivery avoids running Nginx containers in ECS for static assets.
- **API & Durable Worker (`apps/api`):** Amazon ECS on AWS Fargate (`512` CPU / `1024` MB RAM) in private app subnets. API sits behind an internet-facing ALB (TLS 1.3, `/ready` health check). Worker runs `node apps/api/worker.mjs` as a separate ECS service without public ingress.
- **Database:** Amazon RDS PostgreSQL 16.4 (`db.t4g.small` staging, `publicly_accessible = false`, KMS encrypted, `rds.force_ssl = 1`, isolated DB subnets).
- **Queue & Rate Limiting:** Amazon ElastiCache Redis 7.1 (`cache.t4g.micro` staging, TLS + encryption at rest, isolated DB subnets).
- **Storage & Malware Scanning:** Private S3 uploads bucket (SSE-KMS, versioning, 7-day `quarantine/` lifecycle). ClamAV ECS sidecar/service required when `CLAMAV_REQUIRED=true`.
- **Security & Observability:** AWS KMS CMK (annual rotation), AWS Secrets Manager (4 scoped secrets), least-privilege IAM + GitHub OIDC, CloudWatch log groups (30d staging / 90d prod) + CPU alarms.
