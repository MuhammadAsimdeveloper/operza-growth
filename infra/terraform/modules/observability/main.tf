variable "environment" { type = string }
variable "ecs_cluster_name" { type = string }
variable "rds_arn" { type = string }

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/operza-${var.environment}/api"
  retention_in_days = var.environment == "production" ? 90 : 30
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/operza-${var.environment}/worker"
  retention_in_days = var.environment == "production" ? 90 : 30
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/operza-${var.environment}/migrate"
  retention_in_days = 30
}

resource "aws_cloudwatch_metric_alarm" "api_high_cpu" {
  alarm_name          = "operza-${var.environment}-api-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  dimensions          = { ClusterName = var.ecs_cluster_name }
}

output "api_log_group" { value = aws_cloudwatch_log_group.api.name }
output "worker_log_group" { value = aws_cloudwatch_log_group.worker.name }
output "migrate_log_group" { value = aws_cloudwatch_log_group.migrate.name }
