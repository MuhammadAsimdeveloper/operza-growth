# AWS Staging Cost Estimate (Estimates & Assumptions Only)

> *All figures are rough `us-east-1` on-demand estimates, not binding quotes. Zero AWS resources have been provisioned.*

## Option 1: Minimal Internal Staging Footprint (~$105–$140 / month)

| Service | Configuration & Usage Assumption | Est. Monthly Cost |
| --- | --- | --- |
| ECS Fargate (API + Worker) | 1 API + 1 Worker task (`0.5` vCPU / `1` GB RAM each, 24/7) | ~$36–$45 |
| Application Load Balancer | 1 ALB + minimal LCU (<10 GB/mo) | ~$18–$22 |
| Amazon RDS PostgreSQL | `db.t4g.small` Single-AZ, 20 GB gp3, 7d backup | ~$25–$32 |
| ElastiCache Redis | `cache.t4g.micro` Single-node | ~$12–$15 |
| NAT Gateway + S3/CF/KMS/CW | 1 NAT GW (~$32 base) + minimal data transfer + 4 secrets + 1 KMS key | ~$40–$50 |
| **Total Minimal Staging** | *(Note: NAT Gateway is ~$32/mo fixed if private ECS tasks need internet)* | **~$131–$164 / mo** |

## Option 2: Resilient Multi-AZ Staging Footprint (~$230–$295 / month)

| Service | Configuration & Usage Assumption | Est. Monthly Cost |
| --- | --- | --- |
| ECS Fargate (API + Worker) | 2 API + 2 Worker tasks (`0.5` vCPU / `1` GB RAM) + ClamAV sidecar | ~$85–$105 |
| Amazon RDS PostgreSQL | `db.t4g.small` **Multi-AZ**, 50 GB gp3 | ~$52–$65 |
| ElastiCache Redis | `cache.t4g.small` Multi-AZ replication group | ~$45–$55 |
| ALB + NAT + S3/CF/WAF/CW | WAF web ACL + 1–2 NAT Gateways + CloudWatch logs | ~$50–$70 |
| **Total Resilient Staging** | | **~$232–$295 / mo** |
