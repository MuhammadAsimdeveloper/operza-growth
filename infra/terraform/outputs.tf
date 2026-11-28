output "vpc_id" {
  description = "VPC ID"
  value       = module.network.vpc_id
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "api_alb_dns_name" {
  description = "ALB DNS name for API"
  value       = module.ecs.alb_dns_name
}

output "rds_endpoint" {
  description = "Private RDS PostgreSQL endpoint"
  value       = module.database.endpoint
}

output "redis_primary_endpoint" {
  description = "Private ElastiCache Redis primary endpoint"
  value       = module.redis.primary_endpoint
}

output "uploads_bucket_name" {
  description = "Private S3 uploads bucket name"
  value       = module.storage.uploads_bucket_name
}

output "web_cloudfront_domain" {
  description = "CloudFront domain for web SPA"
  value       = module.frontend.web_cloudfront_domain
}

output "marketing_cloudfront_domain" {
  description = "CloudFront domain for marketing site"
  value       = module.frontend.marketing_cloudfront_domain
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC deployment"
  value       = module.iam.github_deploy_role_arn
}
