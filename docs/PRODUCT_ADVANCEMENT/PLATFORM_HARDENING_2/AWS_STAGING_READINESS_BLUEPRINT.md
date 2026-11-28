# AWS Staging Readiness Blueprint — Stage 18 (No Provisioning Performed)

> **Important:** No AWS accounts, VPCs, RDS instances, S3 buckets, ECS services, or cloud resources have been provisioned or deployed in Stage 18. This document is an architectural blueprint only.

## 1. Component-by-Component AWS Staging Proposal

| Component | Proposed AWS Service | Why It Fits | Alternatives | Operational Complexity | Key Security & Cost Drivers |
| --- | --- | --- | --- | --- | --- |
| **Web Frontend (`apps/web`)** | **Amazon S3 + Amazon CloudFront** | Static Vite SPA (`dist/`) with edge caching, TLS via ACM, and SPA fallback routing. | AWS Amplify Hosting | Low | OAC for S3; no secrets in bundle. Cost: low GB egress + CloudFront requests. |
| **Marketing Frontend (`apps/marketing`)** | **Amazon S3 + Amazon CloudFront** | Prerendered Astro static HTML/CSS/assets with `sitemap.xml` & `robots.txt`. | AWS Amplify Hosting | Low | Same CloudFront/ACM pattern; strict cache-control headers. |
| **API Server (`apps/api/server.mjs`)** | **Amazon ECS on AWS Fargate (behind ALB)** | Long-lived Node.js HTTP + WebSocket (`/ws`) server fits container hosting better than Lambda. | AWS App Runner, EC2 | Medium | ALB TLS termination, security groups, `/health` & `/ready` target-group probes. Cost: vCPU/RAM hours + ALB. |
| **Background Worker (`npm run worker`)** | **Amazon ECS on AWS Fargate (worker service)** | Runs continuous outbox/workflow polling & BullMQ consumers with `operza_worker` DB role. | EC2 | Medium | Separate IAM task role from API; scales on queue depth. |
| **PostgreSQL Database** | **Amazon RDS for PostgreSQL (Multi-AZ optional for staging)** | Supports PostgreSQL 15+, `FORCE ROW LEVEL SECURITY`, `operza_app`/`operza_worker` roles, automated snapshots. | Amazon Aurora PostgreSQL | Low–Medium | Private subnet only, SSL enforced (`sslmode=require`), automated backups + PITR. Primary fixed monthly cost driver. |
| **Redis / BullMQ Queue & Rate Limits** | **Amazon ElastiCache for Redis (Valkey/Redis)** | Enables `DISTRIBUTED_RATE_LIMIT_STRICT=true` and multi-worker BullMQ coordination. | Self-managed Redis | Medium | Private subnet, in-transit TLS + AUTH token. |
| **Object / Upload Storage** | **Amazon S3 (private bucket) + ClamAV ECS sidecar/task** | Stores quarantined uploads per `agency_id/location_id` prefix without local disk persistence. | EFS (not recommended for uploads) | Medium | Block all public access, SSE-KMS encryption, presigned short-TTL downloads. |
| **Secrets & KMS** | **AWS Secrets Manager + AWS KMS** | Replaces local env-file `OPERZA_VAULT_KEY` and powers `kms:` adapter in `secret-vault.mjs`. | SSM Parameter Store | Low | IAM least-privilege per ECS task; automatic rotation support. |
| **Logging & Monitoring** | **Amazon CloudWatch Logs + Alarms** | Collects structured JSON stdout logs + `x-request-id` correlation IDs and `/ready` alarms. | Datadog / Grafana Cloud | Low | Log retention policy (e.g., 30 days staging) to control ingestion/storage cost. |
| **Edge Security & TLS** | **AWS WAF + AWS Certificate Manager (ACM)** | Rate-limiting, IP reputation, and managed TLS certificates on CloudFront & ALB. | Cloudflare WAF | Low–Medium | Managed rule groups + rate-based rules on `/api/auth/*`. |
| **CI/CD & Migrations** | **GitHub Actions (OIDC) -> ECR -> Migration Job -> ECS** | Runs `npm test`, builds container, executes `npm run db:migrate` as migration role before rolling ECS. | AWS CodePipeline | Medium | Separate migration DB credentials from `operza_app` runtime credentials. |

## 2. Network Boundaries & Multi-Tenant Security

- **VPC Topology:** Public subnets for ALB and NAT Gateway only; private application subnets for ECS Fargate (API + Worker); isolated database subnets (no internet route) for RDS PostgreSQL and ElastiCache Redis.
- **Security Groups:** ALB accepts 443 from CloudFront/WAF/internet -> forwards to ECS API on container port 4000. RDS (5432) and ElastiCache (6379) accept traffic **only** from ECS API/Worker and migration job security groups.
- **Database Role Separation:** Migration job uses owner role; API uses `operza_app` (`NOBYPASSRLS`); Worker uses `operza_worker` (`NOBYPASSRLS`); Auth lookup uses `operza_auth_definer`. All 82 `agency_id` tables enforce `FORCE ROW LEVEL SECURITY`.
- **TLS & Secrets:** End-to-end TLS (ACM at CloudFront/ALB, `sslmode=require` to RDS, TLS+AUTH to ElastiCache). Zero secrets in container images or S3 bundles; injected at ECS task launch via Secrets Manager.

## 3. Backup, Recovery & Retention Requirements

- **RDS Automated Backups:** 7-day retention for staging (30+ days for production) with Point-in-Time Recovery (PITR) enabled; RPO <= 5 minutes, RTO <= 30 minutes for staging restore drills.
- **Pre-Migration Snapshots:** CI/CD takes a manual RDS snapshot before running `npm run db:migrate` on schema changes.
- **S3 Upload Bucket:** Versioning enabled, lifecycle transition to Glacier/expiration for quarantined or deleted objects, SSE-KMS encryption.
- **Restore Verification:** Monthly automated restore-to-scratch-RDS test required before any production launch claim.

## 4. Estimated Monthly Staging Cost (Assumptions & Estimates Only)

> *All figures are rough us-east-1 on-demand estimates assuming low staging traffic (<10 GB/month egress, single-AZ RDS/Redis, 1 API task + 1 Worker task).*

| Service | Sizing Assumption | Estimated Monthly Cost |
| --- | --- | --- |
| ECS Fargate (API + Worker) | 2 tasks @ 0.5 vCPU / 1 GB RAM, 24/7 | ~\$36–\$45 |
| Application Load Balancer | 1 ALB + minimal LCU | ~\$18–\$22 |
| Amazon RDS PostgreSQL | `db.t4g.small` Single-AZ, 20 GB gp3 | ~\$25–\$32 |
| ElastiCache for Redis | `cache.t4g.micro` Single-node | ~\$12–\$15 |
| S3 + CloudFront + WAF + Secrets/KMS | Minimal staging requests, 2 secrets, 1 KMS key | ~\$10–\$20 |
| **Total Estimated Staging Baseline** | | **~\$101–\$134 / month** |

## 5. Prerequisites & Unresolved Questions Before Staging Provisioning

1. Provision `operza_app`, `operza_worker`, and `operza_auth_definer` roles in RDS bootstrap script before running migrations `001`–`053`.
2. Decide staging RDS instance class (e.g., `db.t4g.small` / `db.t4g.medium`) and single-AZ vs Multi-AZ budget.
3. Configure `ALLOWED_ORIGINS_LIST`, `OPERZA_ADMIN_KEY`, `OPERZA_VAULT_KEY` / KMS key ARN, and `REDIS_URL` in Secrets Manager.
4. Wire ClamAV container/service if `failClosedOnUnavailable: true` is enforced for user uploads.
