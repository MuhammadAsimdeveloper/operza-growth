# Terraform CI Validation (Gate B)

- **Setup:** `hashicorp/setup-terraform@v3` pinned to `terraform_version: '1.9.8'`, working directory `infra/terraform`.
- **Commands:** `terraform version`, `terraform fmt -check -recursive`, `terraform init -backend=false`, `terraform validate`.
- **Safety:** No backend initialization, no `terraform apply`, no AWS credentials, no state files.
- **Status:** Locally YAML-validated; actual remote runner execution awaits push/dispatch.
