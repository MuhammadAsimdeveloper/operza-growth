variable "environment" { type = string }

resource "aws_kms_key" "operza" {
  description             = "Operza ${var.environment} encryption key for RDS, S3, Redis, and Secrets Manager"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "operza" {
  name          = "alias/operza-${var.environment}"
  target_key_id = aws_kms_key.operza.key_id
}

# Secret containers only — values must be populated out-of-band before ECS rollout
resource "aws_secretsmanager_secret" "app_runtime" {
  name                    = "operza/${var.environment}/app-runtime"
  kms_key_id              = aws_kms_key.operza.arn
  recovery_window_in_days = var.environment == "production" ? 30 : 7
}

resource "aws_secretsmanager_secret" "worker_runtime" {
  name                    = "operza/${var.environment}/worker-runtime"
  kms_key_id              = aws_kms_key.operza.arn
  recovery_window_in_days = var.environment == "production" ? 30 : 7
}

resource "aws_secretsmanager_secret" "migration_runtime" {
  name                    = "operza/${var.environment}/migration-runtime"
  kms_key_id              = aws_kms_key.operza.arn
  recovery_window_in_days = var.environment == "production" ? 30 : 7
}

resource "aws_secretsmanager_secret" "provider_sandboxes" {
  name                    = "operza/${var.environment}/provider-sandboxes"
  kms_key_id              = aws_kms_key.operza.arn
  recovery_window_in_days = var.environment == "production" ? 30 : 7
}

output "kms_key_arn" { value = aws_kms_key.operza.arn }
output "app_secret_arn" { value = aws_secretsmanager_secret.app_runtime.arn }
output "worker_secret_arn" { value = aws_secretsmanager_secret.worker_runtime.arn }
output "migration_secret_arn" { value = aws_secretsmanager_secret.migration_runtime.arn }
output "provider_secret_arn" { value = aws_secretsmanager_secret.provider_sandboxes.arn }
