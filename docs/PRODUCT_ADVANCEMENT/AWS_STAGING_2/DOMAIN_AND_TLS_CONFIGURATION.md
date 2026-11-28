# Domain & TLS Configuration

- **Hostnames (Staging Example):**
  - Web SPA: `https://app.staging.operza.example.com` (CloudFront)
  - Marketing Site: `https://staging.operza.example.com` (CloudFront)
  - API & WebSockets: `https://api.staging.operza.example.com` (ALB + `ELBSecurityPolicy-TLS13-1-2-2021-06`)
- **ACM Certificate (`modules/dns_tls`):** DNS-validated wildcard `*.${var.domain_name}` + apex `${var.domain_name}`.
- **CORS & Redirects:** CloudFront enforces `redirect-to-https`; API `ALLOWED_ORIGINS` and `APP_BASE_URL` must list exact staging HTTPS origins only (never `localhost` or production domains).
- **Status:** No public DNS records or ACM certificates were requested or modified in Stage 20.
