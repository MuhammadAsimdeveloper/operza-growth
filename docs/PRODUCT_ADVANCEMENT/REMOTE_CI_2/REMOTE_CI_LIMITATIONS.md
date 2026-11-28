# Remote CI Limitations

1. **Remote Execution Pending:** Because this stage does not push to GitHub or trigger Actions remotely, `infra-validation.yml` has **not** yet executed on a GitHub-hosted runner.
2. **Not AWS Staging:** Passing CI on `ubuntu-latest` proves Terraform syntax/security, Docker builds, and isolated service tests — it does **not** prove AWS account provisioning, RDS IAM/KMS, ElastiCache TLS, or staging deployment.
