# Windows Toolchain Availability

Executed on Windows 11 (`Get-Command` / `--version` / `wsl --status`):

| Tool | Status | Exact Version / Exit Code | Notes |
| --- | --- | --- | --- |
| `node` | **INSTALLED** | `v24.22.0` | Active runtime |
| `npm` | **INSTALLED** | `11.19.1` | Active package manager |
| `git` | **INSTALLED** | `git version 2.56.0.windows.2` | Active VCS |
| `aws` | **INSTALLED** | `aws-cli/2.39.3 Python/3.14.8 Windows/11 exe/AMD64` | Present; no AWS calls executed |
| `wsl` | **NOT INSTALLED** | `wsl --status` exited `50` | WSL2 not enabled |
| `terraform` | **MISSING** | Not found | Prerequisite: install HashiCorp Terraform `>= 1.6.0` |
| `tflint` / `checkov` / `tfsec` | **MISSING** | Not found | Optional IaC scanners |
| `docker` / `docker compose` | **MISSING** | Not found | Prerequisite: Docker Desktop / Docker Engine |
| `redis-server` / `redis-cli` | **MISSING** | Not found | Prerequisite: Redis 7 (or CI Gate 3) |
| `clamdscan` | **MISSING** | Not found | Prerequisite: ClamAV daemon (or staging container) |

*(Per policy, no OS features, WSL2, Docker Desktop, or external binaries were installed.)*
