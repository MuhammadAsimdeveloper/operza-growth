variable "environment" { type = string }
variable "subnet_ids" { type = list(string) }
variable "rds_sg_id" { type = string }
variable "kms_key_arn" { type = string }
variable "instance_class" { type = string }
variable "multi_az" { type = bool }
variable "backup_retention_days" { type = number }

resource "aws_db_subnet_group" "this" {
  name       = "operza-${var.environment}-db-subnets"
  subnet_ids = var.subnet_ids
}

resource "aws_db_parameter_group" "pg16" {
  name   = "operza-${var.environment}-pg16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "aws_db_instance" "this" {
  identifier                      = "operza-${var.environment}-pg"
  engine                          = "postgres"
  engine_version                  = "16.4"
  instance_class                  = var.instance_class
  allocated_storage               = 20
  max_allocated_storage           = 100
  storage_type                    = "gp3"
  storage_encrypted               = true
  kms_key_id                      = var.kms_key_arn
  db_name                         = "operza_${var.environment}"
  username                        = "operza_rds_admin"
  manage_master_user_password     = true
  master_user_secret_kms_key_id   = var.kms_key_arn
  publicly_accessible             = false
  multi_az                        = var.multi_az
  db_subnet_group_name            = aws_db_subnet_group.this.name
  vpc_security_group_ids          = [var.rds_sg_id]
  parameter_group_name            = aws_db_parameter_group.pg16.name
  backup_retention_period         = var.backup_retention_days
  backup_window                   = "03:00-04:00"
  maintenance_window              = "sun:04:30-sun:05:30"
  deletion_protection             = var.environment == "production" ? true : false
  skip_final_snapshot             = var.environment == "production" ? false : true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
}

output "endpoint" { value = aws_db_instance.this.endpoint }
output "arn" { value = aws_db_instance.this.arn }
