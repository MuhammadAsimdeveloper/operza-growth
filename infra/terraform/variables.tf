variable "environment" {
  description = "Deployment environment (staging or production)"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "domain_name" {
  description = "Base domain name for the environment (e.g. staging.operza.example.com)"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.20.0.0/16"
}

variable "db_instance_class" {
  description = "RDS PostgreSQL instance class"
  type        = string
  default     = "db.t4g.small"
}

variable "db_multi_az" {
  description = "Enable Multi-AZ for RDS"
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "RDS automated backup retention in days"
  type        = number
  default     = 7
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.t4g.micro"
}

variable "api_desired_count" {
  description = "Desired ECS API task count"
  type        = number
  default     = 1
}

variable "worker_desired_count" {
  description = "Desired ECS Worker task count"
  type        = number
  default     = 1
}

variable "github_repo" {
  description = "GitHub repository (owner/repo) allowed to assume OIDC deploy role"
  type        = string
  default     = "MuhammadAsimdeveloper/operza-growth"
}
