# Toolchain Availability Report

Inspected directly on the Windows development host (no large toolchains installed without approval):

| Tool | Status | Version / Path | Verification Impact |
| --- | --- | --- | --- |
| `node` | **INSTALLED** | `v24.22.0` | All Node.js tests, local staging simulation, and static validators executed. |
| `npm` | **INSTALLED** | `11.19.1` | Workspace scripts and `npm audit` executed. |
| `git` | **INSTALLED** | `2.56.0.windows.2` | Branch/diff/commit checks executed. |
| `aws` | **INSTALLED** | `aws-cli/2.39.3 Python/3.14.8` | Present; no AWS calls executed (no provisioning authorized). |
| `PostgreSQL` (`IsolatedTestPostgres`) | **INSTALLED** | Local embedded PG test server | Full 54-migration bootstrap, `operza_app`/`operza_worker` simulation executed. |
| `terraform` | **MISSING** | Not installed | `terraform fmt`, `terraform init`, `terraform validate`, `terraform plan` **not executed locally**. |
| `tflint` / `checkov` / `tfsec` | **MISSING** | Not installed | External IaC scanners **not executed locally**. |
| `docker` / `docker compose` | **MISSING** | Not installed | `docker build` and `docker compose config` **not executed locally**. |
| `redis-server` / `redis-cli` | **MISSING** | Not installed | Live Redis integration **not executed locally**. |
| `clamdscan` | **MISSING** | Not installed | Live ClamAV / EICAR scan **not executed locally**. |
