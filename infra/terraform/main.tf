module "network" {
  source      = "./modules/network"
  environment = var.environment
  vpc_cidr    = var.vpc_cidr
}

module "security_groups" {
  source      = "./modules/security_groups"
  environment = var.environment
  vpc_id      = module.network.vpc_id
}

module "secrets_kms" {
  source      = "./modules/secrets_kms"
  environment = var.environment
}

module "database" {
  source                = "./modules/database"
  environment           = var.environment
  subnet_ids            = module.network.isolated_db_subnet_ids
  rds_sg_id             = module.security_groups.rds_sg_id
  kms_key_arn           = module.secrets_kms.kms_key_arn
  instance_class        = var.db_instance_class
  multi_az              = var.db_multi_az
  backup_retention_days = var.db_backup_retention_days
}

module "redis" {
  source      = "./modules/redis"
  environment = var.environment
  subnet_ids  = module.network.isolated_db_subnet_ids
  redis_sg_id = module.security_groups.redis_sg_id
  kms_key_arn = module.secrets_kms.kms_key_arn
  node_type   = var.redis_node_type
}

module "storage" {
  source      = "./modules/storage"
  environment = var.environment
  kms_key_arn = module.secrets_kms.kms_key_arn
}

module "dns_tls" {
  source      = "./modules/dns_tls"
  environment = var.environment
  domain_name = var.domain_name
}

module "frontend" {
  source              = "./modules/frontend"
  environment         = var.environment
  acm_certificate_arn = module.dns_tls.acm_certificate_arn
}

module "iam" {
  source               = "./modules/iam"
  environment          = var.environment
  github_repo          = var.github_repo
  kms_key_arn          = module.secrets_kms.kms_key_arn
  app_secret_arn       = module.secrets_kms.app_secret_arn
  worker_secret_arn    = module.secrets_kms.worker_secret_arn
  migration_secret_arn = module.secrets_kms.migration_secret_arn
  provider_secret_arn  = module.secrets_kms.provider_secret_arn
  uploads_bucket_arn   = module.storage.uploads_bucket_arn
}

module "ecs" {
  source                 = "./modules/ecs"
  environment            = var.environment
  vpc_id                 = module.network.vpc_id
  public_subnet_ids      = module.network.public_subnet_ids
  private_app_subnet_ids = module.network.private_app_subnet_ids
  alb_sg_id              = module.security_groups.alb_sg_id
  ecs_sg_id              = module.security_groups.ecs_sg_id
  execution_role_arn     = module.iam.ecs_execution_role_arn
  api_task_role_arn      = module.iam.api_task_role_arn
  worker_task_role_arn   = module.iam.worker_task_role_arn
  api_desired_count      = var.api_desired_count
  worker_desired_count   = var.worker_desired_count
  acm_certificate_arn    = module.dns_tls.acm_certificate_arn
}

module "observability" {
  source           = "./modules/observability"
  environment      = var.environment
  ecs_cluster_name = module.ecs.cluster_name
  rds_arn          = module.database.arn
}
