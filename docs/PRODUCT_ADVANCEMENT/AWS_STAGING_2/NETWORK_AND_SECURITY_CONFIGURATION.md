# Network & Security Configuration

- **Subnets:** `public` (ALB + NAT only, `map_public_ip_on_launch = false`), `private_app` (ECS API & Worker), `isolated_db` (RDS + ElastiCache, zero internet route).
- **Security Groups:**
  - `alb-sg`: Ingress `443` (`0.0.0.0/0`).
  - `ecs-sg`: Ingress `4000` from `alb-sg` only.
  - `rds-sg`: Ingress `5432` from `ecs-sg` only (`0.0.0.0/0` prohibited).
  - `redis-sg`: Ingress `6379` from `ecs-sg` only (`0.0.0.0/0` prohibited).
- **IAM:** `api_task` and `worker_task` roles have no `*` wildcards; each is scoped to its own Secrets Manager ARN, KMS key ARN, and S3 uploads prefix.
- **S3 & KMS:** All buckets enforce `block_public_acls`, `block_public_policy`, `ignore_public_acls`, `restrict_public_buckets`, and KMS encryption with annual key rotation.
