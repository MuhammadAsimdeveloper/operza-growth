variable "environment" { type = string }
variable "subnet_ids" { type = list(string) }
variable "redis_sg_id" { type = string }
variable "kms_key_arn" { type = string }
variable "node_type" { type = string }

resource "aws_elasticache_subnet_group" "this" {
  name       = "operza-${var.environment}-redis-subnets"
  subnet_ids = var.subnet_ids
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = "operza-${var.environment}-redis"
  description                = "Operza ${var.environment} Redis for BullMQ and strict distributed rate limiting"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.node_type
  num_cache_clusters         = var.environment == "production" ? 2 : 1
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [var.redis_sg_id]
  at_rest_encryption_enabled = true
  kms_key_id                 = var.kms_key_arn
  transit_encryption_enabled = true
  automatic_failover_enabled = var.environment == "production" ? true : false
}

output "primary_endpoint" { value = aws_elasticache_replication_group.this.primary_endpoint_address }
