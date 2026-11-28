# Staging Blocker Register

| ID | Blocker | Why Blocked Locally | Required Operator / CI Action |
| --- | --- | --- | --- |
| **B-01** | `terraform validate` & `terraform plan` | `terraform` CLI not installed on Windows host; no AWS backend | Run `terraform fmt -check -recursive && terraform init && terraform validate && terraform plan` on CI/operator workstation. |
| **B-02** | Docker image build & `compose config` | `docker` CLI & daemon not installed (WSL2 not enabled) | Run CI Gate 3 (`docker/build-push-action@v5`) or build on Docker host. |
| **B-03** | Live Redis & BullMQ multi-worker test | `redis-server` absent locally | Run CI Gate 3 (`redis:7-alpine`) and verify against ElastiCache in staging. |
| **B-04** | Live ClamAV EICAR scan | `clamdscan` absent locally | Run EICAR test against ClamAV container in staging before enabling uploads. |
| **B-05** | AWS OIDC, Secrets Manager & RDS bootstrap | No AWS provisioning authorized | Provision via Terraform, run `bootstrap-rds-roles.sql`, populate Secrets Manager. |
