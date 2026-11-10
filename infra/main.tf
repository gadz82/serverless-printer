terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = merge(var.tags, {
      Project = var.name_prefix
    })
  }
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  # Bootstrap names these resources deterministically. The fallbacks keep
  # validate and the pull-request plan usable before an operator supplies the
  # bootstrap outputs; release deployments pass both values explicitly.
  artifacts_bucket = coalesce(var.artifacts_bucket, "${var.name_prefix}-artifacts")
  deploy_role_arn = coalesce(
    var.deploy_role_arn,
    "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${var.name_prefix}-deploy",
  )

  vpc_id                    = try(module.network[0].vpc_id, null)
  vpc_subnet_ids            = try(module.network[0].private_subnet_ids, [])
  worker_security_group_ids = try(module.network[0].worker_security_group_ids, [])
}

module "network" {
  count  = var.vpc_mode == "none" ? 0 : 1
  source = "./modules/network"

  name_prefix        = var.name_prefix
  region             = var.region
  vpc_mode           = var.vpc_mode
  vpc_cidr           = var.vpc_cidr
  az_count           = var.az_count
  availability_zones = var.availability_zones

  enable_nat_gateway     = var.enable_nat_gateway
  enable_s3_endpoint     = var.enable_s3_endpoint
  enable_sqs_endpoint    = var.enable_sqs_endpoint
  enable_lambda_endpoint = var.enable_lambda_endpoint
  enable_events_endpoint = var.enable_events_endpoint

  vpc_id                    = var.vpc_id
  vpc_tags                  = var.vpc_tags
  subnet_ids                = var.subnet_ids
  subnet_tags               = var.subnet_tags
  worker_security_group_ids = var.worker_security_group_ids

  tags = var.tags
}

module "printer" {
  source = "./modules/printer"

  name_prefix            = var.name_prefix
  release                = var.release
  artifacts_bucket       = local.artifacts_bucket
  deploy_role_arn        = local.deploy_role_arn
  vpc_mode               = var.vpc_mode
  vpc_subnet_ids         = local.vpc_subnet_ids
  vpc_security_group_ids = local.worker_security_group_ids

  allowed_sender_account_ids    = var.allowed_sender_account_ids
  allowed_sender_principal_arns = var.allowed_sender_principal_arns
  organization_id               = var.organization_id
  callback_target_arns          = var.callback_target_arns
  callback_allowlist            = var.callback_allowlist

  caller_role_mode              = var.caller_role_mode
  caller_role_arn               = var.caller_role_arn
  caller_trusted_principal_arns = var.caller_trusted_principal_arns
  worker_role_mode              = var.worker_role_mode
  worker_role_arn               = var.worker_role_arn

  handlebars_mode     = var.handlebars_mode
  pdfa_allowed_levels = var.pdfa_allowed_levels
  event_source        = var.event_source
  presign_ttl_seconds = var.presign_ttl_seconds
  max_receive_count   = var.max_receive_count
  batch_size          = var.batch_size
  maximum_concurrency = var.maximum_concurrency
  worker_memory_size  = var.worker_memory_size

  reserved_concurrency = var.reserved_concurrency

  enable_alarms       = var.enable_alarms
  alarm_sns_topic_arn = var.alarm_sns_topic_arn
  log_retention_days  = var.log_retention_days

  tags = var.tags
}

output "jobs_queue_url" {
  description = "URL of the jobs queue that accepts print jobs."
  value       = module.printer.jobs_queue_url
}

output "jobs_queue_arn" {
  description = "ARN of the jobs queue."
  value       = module.printer.jobs_queue_arn
}

output "jobs_dlq_url" {
  description = "URL of the dead-letter queue for jobs that exceed max_receive_count."
  value       = module.printer.jobs_dlq_url
}

output "jobs_dlq_arn" {
  description = "ARN of the dead-letter queue."
  value       = module.printer.jobs_dlq_arn
}

output "prints_bucket" {
  description = "Name of the S3 bucket that holds transient print objects."
  value       = module.printer.prints_bucket
}

output "smoke_queue_url" {
  description = "URL of the queue that receives release-smoke results."
  value       = module.printer.smoke_queue_url
}

output "smoke_queue_arn" {
  description = "ARN of the release-smoke results queue."
  value       = module.printer.smoke_queue_arn
}

output "function_name" {
  description = "Name of the render worker Lambda function."
  value       = module.printer.function_name
}

output "function_alias_arn" {
  description = "ARN of the live alias that receives the jobs event source mapping."
  value       = module.printer.function_alias_arn
}

output "caller_role_arn" {
  description = "ARN of the caller role allowed to publish jobs."
  value       = module.printer.caller_role_arn
}

output "caller_role_created" {
  description = "True when Terraform created the caller role; false when a provided role is used."
  value       = module.printer.caller_role_created
}

output "worker_role_arn" {
  description = "ARN of the render worker execution role, created or provided."
  value       = module.printer.worker_role_arn
}

output "worker_role_created" {
  description = "True when Terraform created the worker role; false when a provided role is used."
  value       = module.printer.worker_role_created
}

output "kms_key_arn" {
  description = "ARN of the project KMS key that encrypts print objects."
  value       = module.printer.kms_key_arn
}

output "vpc_id" {
  description = "ID of the worker VPC when vpc_mode is create or lookup, otherwise null."
  value       = local.vpc_id
}

output "worker_subnet_ids" {
  description = "Subnets attached to the worker when vpc_mode is create or lookup, otherwise empty."
  value       = module.printer.vpc_subnet_ids
}

output "worker_security_group_ids" {
  description = "Security groups attached to the worker when vpc_mode is create or lookup, otherwise empty."
  value       = module.printer.worker_security_group_ids
}
