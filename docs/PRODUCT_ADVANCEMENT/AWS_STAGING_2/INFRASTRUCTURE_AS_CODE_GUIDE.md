# Infrastructure as Code Guide (`infra/terraform/`)

**Framework Selected:** Terraform (`>= 1.6.0`, `hashicorp/aws ~> 5.0`) — zero Node.js dependency bloat, clean modular boundaries, native `plan`/`validate` gates, and explicit state approval.

## Module Structure

1. `modules/network` — VPC (`10.20.0.0/16` staging), 2 AZs, public/private-app/isolated-db subnets, IGW, NAT Gateway.
2. `modules/security_groups` — ALB (443), ECS (4000 from ALB only), RDS (5432 from ECS only), Redis (6379 from ECS only).
3. `modules/secrets_kms` — KMS CMK + 4 Secrets Manager containers (`app-runtime`, `worker-runtime`, `migration-runtime`, `provider-sandboxes`).
4. `modules/database` — RDS PostgreSQL 16.4 (`publicly_accessible = false`, `rds.force_ssl = 1`, KMS).
5. `modules/redis` — ElastiCache Redis 7.1 (`transit_encryption_enabled = true`, `at_rest_encryption_enabled = true`).
6. `modules/storage` — Private S3 uploads bucket (SSE-KMS, versioning, `quarantine/` lifecycle).
7. `modules/dns_tls` — ACM certificate with DNS validation.
8. `modules/frontend` — S3 + CloudFront OAC for `web` SPA and `marketing` static site.
9. `modules/iam` — Least-privilege ECS execution/API/Worker task roles + GitHub OIDC deploy role.
10. `modules/ecs` — ECS Cluster, ECR repo (immutable tags + scan on push), ALB, API & Worker services.
11. `modules/observability` — CloudWatch log groups + CPU alarm.
12. `environments/staging/terraform.tfvars.example` & `environments/production/terraform.tfvars.example`.

**Local Validation:** `node scripts/validate-staging-infra.mjs` verified all **15** `.tf` files (balanced braces, no secrets, security invariants). `terraform` binary is not installed locally so `terraform validate`/`plan` remains to be run in CI or an operator workstation.
