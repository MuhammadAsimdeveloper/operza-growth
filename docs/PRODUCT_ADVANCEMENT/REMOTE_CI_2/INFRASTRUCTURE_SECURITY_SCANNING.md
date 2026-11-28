# Infrastructure Security Scanning (Gate C)

- **Tooling:** `aquasecurity/tfsec-action@v1.0.3` scanning `infra/terraform` locally inside the runner (no external SaaS upload).
- **Output & Policy:** Produces `tfsec-results.sarif` (uploaded as artifact `tfsec-sarif-report`), `soft_fail: false` so high/critical findings block the pipeline.
